use serde_json::{json, Value};
use std::{collections::hash_map::DefaultHasher, fs, hash::{Hash, Hasher}, io::{BufRead, BufReader}, path::{Path, PathBuf}, process::{Command, Stdio}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::Duration};
use tauri::{Emitter, Manager};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

fn kill_worker(child: &mut std::process::Child) {
    #[cfg(windows)] {
        // Include the worker's FFmpeg subprocess in cancellation.
        let mut command = Command::new("taskkill.exe");
        command.args(["/PID", &child.id().to_string(), "/T", "/F"]).creation_flags(0x08000000)
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        let _ = command.status();
    }
    let _ = child.kill(); let _ = child.wait();
}

const ENGINE_VERSION: &str = "native-six-stem-v1";
#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisOptions {
    pub transcriber: String, pub device: String,
    pub model_path: Option<String>, pub hf_token: Option<String>,
}
impl AnalysisOptions {
    fn validate(&self) -> Result<(), String> {
        if !["basic-pitch", "muscriptor-small", "muscriptor-medium", "muscriptor-large"].contains(&self.transcriber.as_str())
            || !["auto", "cpu", "openvino"].contains(&self.device.as_str()) { return Err("Ungültige Modellauswahl".into()); }
        if self.hf_token.as_ref().is_some_and(|t| t.len() > 4096) { return Err("Ungültiger Zugangstoken".into()); }
        Ok(())
    }
}

#[derive(Default)]
pub struct AnalysisState { active: Mutex<Option<(String, Arc<AtomicBool>)>> }

pub(crate) fn runtime_dir() -> Result<PathBuf, String> {
    let adjacent = std::env::current_exe().map_err(|e| e.to_string())?.parent().ok_or("Programmordner fehlt")?.join("LoopStudio-runtime");
    let development = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../LoopStudio-runtime");
    let configured = std::env::var_os("LOOPSTUDIO_RUNTIME").map(PathBuf::from);
    configured.into_iter().chain([adjacent, development]).find(|p| p.join("runtime/onnxruntime.dll").is_file())
        .ok_or_else(|| "Die native Analyseumgebung fehlt. Bitte setup-analysis.ps1 im Projektordner ausführen.".into())
}

#[tauri::command]
pub fn analysis_ready() -> bool { runtime_dir().is_ok_and(|p| p.join("loopstudio-analysis.exe").is_file() && p.join("runtime/ffmpeg.exe").is_file() && p.join("models/htdemucs_6s.onnx").is_file()) }

#[tauri::command]
pub fn cancel_analysis(state: tauri::State<AnalysisState>, job_id: String) -> Result<(), String> {
    if let Some((id, cancel)) = state.active.lock().map_err(|e| e.to_string())?.as_ref() {
        if id == &job_id { cancel.store(true, Ordering::Relaxed); }
    }
    Ok(())
}

pub fn stop(state: tauri::State<AnalysisState>) {
    if let Ok(active) = state.active.lock() {
        if let Some((_, cancel)) = active.as_ref() { cancel.store(true, Ordering::Relaxed); }
    }
}

#[tauri::command]
pub fn stage_media(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Binäre Mediendatei erwartet".into()); };
    if bytes.is_empty() || bytes.len() > 512 * 1024 * 1024 { return Err("Für größere Dateien bitte Datei öffnen verwenden.".into()); }
    let mut hash = DefaultHasher::new(); bytes.hash(&mut hash);
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("imports");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{:x}.media", hash.finish()));
    if !path.exists() { fs::write(&path, bytes).map_err(|e| e.to_string())?; }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn analyze_passage(app: tauri::AppHandle, source: String, start: f64, end: f64, job_id: String, options: AnalysisOptions, force: Option<bool>) -> Result<Value, String> {
    validate_range(start, end)?;
    options.validate()?;
    if job_id.is_empty() || job_id.len() > 100 || !job_id.bytes().all(|b| b.is_ascii_alphanumeric() || b==b'-') { return Err("Ungültiger Analyseauftrag".into()); }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<AnalysisState>();
        let mut active = state.active.lock().map_err(|e| e.to_string())?;
        if active.is_some() { return Err("Eine Analyse läuft bereits.".into()); }
        *active = Some((job_id.clone(), cancel.clone()));
    }
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || run_job(&worker_app, &source, start, end, &job_id, cancel, options, force.unwrap_or(false))).await.map_err(|e| e.to_string()).and_then(|r| r);
    if let Ok(mut active) = app.state::<AnalysisState>().active.lock() { *active = None; }
    result
}

fn validate_range(start: f64, end: f64) -> Result<(), String> {
    if !start.is_finite() || !end.is_finite() || start < 0. || !(0.1..=180.).contains(&(end - start)) {
        return Err("Bitte eine Passage zwischen 0,1 Sekunden und 3 Minuten wählen.".into());
    }
    Ok(())
}

fn analysis_key(source:&Path, metadata:&fs::Metadata, start:f64, end:f64, options:&AnalysisOptions, runtime:&Path)->String {
    let mut hash = DefaultHasher::new();
    source.hash(&mut hash); metadata.len().hash(&mut hash); metadata.modified().ok().hash(&mut hash);
    start.to_bits().hash(&mut hash); end.to_bits().hash(&mut hash); ENGINE_VERSION.hash(&mut hash); options.transcriber.hash(&mut hash); options.device.hash(&mut hash);
    if let Some(path) = &options.model_path {
        path.hash(&mut hash);
        if let Ok(meta) = fs::metadata(path) { meta.len().hash(&mut hash); meta.modified().ok().hash(&mut hash); }
    }
    for path in [runtime.join("loopstudio-analysis.exe"), runtime.join("models/htdemucs_6s.onnx")] {
        if let Ok(meta) = fs::metadata(path) { meta.len().hash(&mut hash); meta.modified().ok().hash(&mut hash); }
    }
    format!("{:x}",hash.finish())
}

#[tauri::command]
pub async fn find_cached_analysis(app:tauri::AppHandle,source:String,start:f64,end:f64)->Result<Option<Value>,String> {
    validate_range(start,end)?;
    tauri::async_runtime::spawn_blocking(move||{
        let runtime=runtime_dir()?;
        let source=fs::canonicalize(source).map_err(|e|e.to_string())?;
        let metadata=source.metadata().map_err(|e|e.to_string())?;
        let root=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("analysis");
        let mut matches=Vec::new();
        // Recover pre-existing native cache entries whose loop had only time bounds.
        for transcriber in ["basic-pitch","muscriptor-small","muscriptor-medium","muscriptor-large"] {
            for device in ["auto","cpu","openvino"] {
                let options=AnalysisOptions{transcriber:transcriber.into(),device:device.into(),model_path:None,hf_token:None};
                let path=root.join(analysis_key(&source,&metadata,start,end,&options,&runtime)).join("result.json");
                if let Ok(bytes)=fs::read(&path) {
                    if let Ok(value)=serde_json::from_slice::<Value>(&bytes) {
                        if value["stems"].as_array().is_some_and(|stems|stems.len()==6) {
                            matches.push((path.metadata().ok().and_then(|m|m.modified().ok()),value));
                        }
                    }
                }
            }
        }
        matches.sort_by_key(|m|m.0);
        if let Some((_,result))=matches.pop() { crate::loop_material::authorize_analysis(&app,&result)?;Ok(Some(result)) }else{Ok(None)}
    }).await.map_err(|e|e.to_string())?
}

fn analysis_output_dir(root:&Path,key:&str,job_id:&str,force:bool)->PathBuf {
    root.join(if force{format!("{key}-{job_id}")}else{key.to_owned()})
}
fn publish_analysis_result(folder:&Path,result:&Value)->Result<(),String>{
    use std::io::Write;
    fs::create_dir_all(folder).map_err(|e|e.to_string())?;
    let mut temporary=tempfile::NamedTempFile::new_in(folder).map_err(|e|e.to_string())?;
    temporary.write_all(&serde_json::to_vec(result).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    temporary.persist(folder.join("result.json")).map_err(|e|e.error.to_string())?;
    Ok(())
}

fn run_job(app: &tauri::AppHandle, source: &str, start: f64, end: f64, job_id: &str, cancel: Arc<AtomicBool>, options: AnalysisOptions, force: bool) -> Result<Value, String> {
    let runtime = runtime_dir()?;
    if !runtime.join("loopstudio-analysis.exe").is_file() { return Err("Der native Analyseprozess fehlt. Bitte build-local.ps1 und setup-analysis.ps1 ausführen.".into()); }
    let source = fs::canonicalize(source).map_err(|_| "Die Originaldatei ist nicht mehr erreichbar.")?;
    let metadata = source.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() { return Err("Bitte eine Audio- oder Videodatei auswählen.".into()); }
    let key=analysis_key(&source,&metadata,start,end,&options,&runtime);
    let root=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("analysis");
    let output=analysis_output_dir(&root,&key,job_id,force);
    fs::create_dir_all(&output).map_err(|e| e.to_string())?;
    let manifest = output.join("result.json");
    let cache_valid = fs::read(&manifest).ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .is_some_and(|value| value["engine"] == "rust" && value["version"] == 2 && value["stems"].as_array().is_some_and(|stems| stems.len() == 6 && stems.iter().all(|stem| {
            stem["path"].as_str().is_some_and(|path| Path::new(path).is_file())
        })));
    if !cache_valid || force {
        let log = fs::File::create(output.join("analysis.log")).map_err(|e| e.to_string())?;
        let mut command = Command::new(runtime.join("loopstudio-analysis.exe"));
        command.arg("--source").arg(source).arg("--start").arg(start.to_string())
            .arg("--end").arg(end.to_string()).arg("--output").arg(&output).arg("--home").arg(&runtime)
            .arg("--transcriber").arg(&options.transcriber).arg("--device").arg(&options.device)
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(log);
        if let Some(path) = options.model_path.as_ref().filter(|s| !s.is_empty()) { command.arg("--muscriptor-model").arg(path); }
        if let Some(token) = options.hf_token.as_ref().filter(|s| !s.trim().is_empty()) { command.env("HF_TOKEN", token); }
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command.spawn().map_err(|e| format!("Analyse konnte nicht gestartet werden: {e}"))?;
        let stdout = child.stdout.take().ok_or("Analyseausgabe fehlt")?;
        let event_app = app.clone(); let id = job_id.to_owned();
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    if value["percent"].is_null() { continue; }
                    let _ = event_app.emit("analysis-progress", json!({"jobId":id, "message":value["message"], "percent":value["percent"]}));
                }
            }
        });
        let status = loop {
            if cancel.load(Ordering::Relaxed) {
                kill_worker(&mut child);
                // The worker can have completed just before cancellation; never remove its valid cache.
                return Err("Analyse abgebrochen.".into());
            }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(error) => { kill_worker(&mut child); return Err(error.to_string()); }
            }
        };
        let _ = reader.join();
        if !status.success() { let details = fs::read_to_string(output.join("analysis.log")).unwrap_or_default();
            let mut message = details.lines().rev().take(5).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
            if let Some(token) = options.hf_token.as_ref().filter(|s| !s.is_empty()) { message = message.replace(token, "[Token]"); }
            return Err(format!("Analyse fehlgeschlagen: {message}")); }
    }
    if cancel.load(Ordering::Relaxed) { return Err("Analyse abgebrochen.".into()); }
    let result: Value = serde_json::from_slice(&fs::read(manifest).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if force { publish_analysis_result(&root.join(&key),&result)?; }
    crate::loop_material::authorize_analysis(app,&result)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn forced_reanalysis_preserves_saved_audio_and_updates_only_the_cache_pointer(){
        let dir=tempfile::tempdir().unwrap();let old=analysis_output_dir(dir.path(),"cache","old",false);let new=analysis_output_dir(dir.path(),"cache","new",true);
        assert_ne!(old,new);fs::create_dir_all(&old).unwrap();fs::create_dir_all(&new).unwrap();
        fs::write(old.join("guitar.wav"),b"original").unwrap();fs::write(new.join("guitar.wav"),b"new").unwrap();
        let result=json!({"stems":[{"path":new.join("guitar.wav")}]});publish_analysis_result(&old,&result).unwrap();
        assert_eq!(fs::read(old.join("guitar.wav")).unwrap(),b"original");
        let stored:Value=serde_json::from_slice(&fs::read(old.join("result.json")).unwrap()).unwrap();assert_eq!(stored,result);
    }
    #[test]
    fn model_selection_rejects_unknown_backends() {
        let mut options = AnalysisOptions {transcriber:"muscriptor-small".into(),device:"cpu".into(),model_path:None,hf_token:None};
        assert!(options.validate().is_ok());
        options.transcriber="unknown".into(); assert!(options.validate().is_err());
        options.transcriber="basic-pitch".into(); options.device="cuda".into(); assert!(options.validate().is_err());
    }
    #[test]
    fn selected_region_is_bounded() {
        assert!(validate_range(5., 10.).is_ok());
        for (a, b) in [(0., 181.), (-1., 1.), (5., 4.), (0., f64::NAN), (0., f64::INFINITY)] { assert!(validate_range(a, b).is_err()); }
    }
}
