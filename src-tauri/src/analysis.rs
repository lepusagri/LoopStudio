use serde_json::{json, Value};
use std::{collections::hash_map::DefaultHasher, fs, hash::{Hash, Hasher}, io::{BufRead, BufReader}, path::{Path, PathBuf}, process::{Command, Stdio}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::Duration};
use tauri::{Emitter, Manager};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

const WORKER: &str = include_str!("../../engine/analyze.py");

#[derive(Default)]
pub struct AnalysisState { active: Mutex<Option<(String, Arc<AtomicBool>)>> }

fn runtime_dir() -> Result<PathBuf, String> {
    let adjacent = std::env::current_exe().map_err(|e| e.to_string())?.parent().ok_or("Programmordner fehlt")?.join("LoopStudio-runtime");
    let development = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../LoopStudio-runtime");
    [adjacent, development].into_iter().find(|p| p.join("Scripts/python.exe").exists())
        .ok_or_else(|| "Die lokale Analyseumgebung fehlt. Bitte setup-analysis.ps1 im Projektordner ausführen.".into())
}

#[tauri::command]
pub fn analysis_ready() -> bool { runtime_dir().is_ok_and(|p| p.join("ready.json").exists()) }

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
pub async fn analyze_passage(app: tauri::AppHandle, source: String, start: f64, end: f64, job_id: String) -> Result<Value, String> {
    validate_range(start, end)?;
    if job_id.is_empty() || job_id.len() > 100 { return Err("Ungültiger Analyseauftrag".into()); }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<AnalysisState>();
        let mut active = state.active.lock().map_err(|e| e.to_string())?;
        if active.is_some() { return Err("Eine Analyse läuft bereits.".into()); }
        *active = Some((job_id.clone(), cancel.clone()));
    }
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || run_job(&worker_app, &source, start, end, &job_id, cancel)).await.map_err(|e| e.to_string()).and_then(|r| r);
    if let Ok(mut active) = app.state::<AnalysisState>().active.lock() { *active = None; }
    result
}

fn validate_range(start: f64, end: f64) -> Result<(), String> {
    if !start.is_finite() || !end.is_finite() || start < 0. || !(0.1..=180.).contains(&(end - start)) {
        return Err("Bitte eine Passage zwischen 0,1 Sekunden und 3 Minuten wählen.".into());
    }
    Ok(())
}

fn run_job(app: &tauri::AppHandle, source: &str, start: f64, end: f64, job_id: &str, cancel: Arc<AtomicBool>) -> Result<Value, String> {
    let runtime = runtime_dir()?;
    if !runtime.join("ready.json").exists() { return Err("Die Analyseumgebung ist noch nicht eingerichtet. Bitte setup-analysis.ps1 ausführen.".into()); }
    let source = fs::canonicalize(source).map_err(|_| "Die Originaldatei ist nicht mehr erreichbar.")?;
    let metadata = source.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() { return Err("Bitte eine Audio- oder Videodatei auswählen.".into()); }
    let mut hash = DefaultHasher::new();
    source.hash(&mut hash); metadata.len().hash(&mut hash); metadata.modified().ok().hash(&mut hash);
    start.to_bits().hash(&mut hash); end.to_bits().hash(&mut hash); WORKER.hash(&mut hash);
    let root = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("analysis");
    let output = root.join(format!("{:x}", hash.finish()));
    fs::create_dir_all(&output).map_err(|e| e.to_string())?;
    let manifest = output.join("result.json");
    let cache_valid = fs::read(&manifest).ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .is_some_and(|value| value["stems"].as_array().is_some_and(|stems| stems.len() == 6 && stems.iter().all(|stem| {
            stem["path"].as_str().is_some_and(|path| Path::new(path).is_file())
        })));
    if !cache_valid {
        let worker = output.join("worker.py");
        fs::write(&worker, WORKER).map_err(|e| e.to_string())?;
        let log = fs::File::create(output.join("analysis.log")).map_err(|e| e.to_string())?;
        let mut command = Command::new(runtime.join("Scripts/python.exe"));
        command.args(["-u"]).arg(worker).arg("--source").arg(source).arg("--start").arg(start.to_string())
            .arg("--end").arg(end.to_string()).arg("--output").arg(&output).arg("--models").arg(runtime.join("models"))
            .env("PYTHONUTF8", "1").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(log);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command.spawn().map_err(|e| format!("Analyse konnte nicht gestartet werden: {e}"))?;
        let stdout = child.stdout.take().ok_or("Analyseausgabe fehlt")?;
        let event_app = app.clone(); let id = job_id.to_owned();
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    let _ = event_app.emit("analysis-progress", json!({"jobId":id, "message":value["message"], "percent":value["percent"]}));
                }
            }
        });
        let status = loop {
            if cancel.load(Ordering::Relaxed) {
                let _ = child.kill(); let _ = child.wait();
                // The worker can have completed just before cancellation; never remove its valid cache.
                return Err("Analyse abgebrochen.".into());
            }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(error) => { let _ = child.kill(); let _ = child.wait(); return Err(error.to_string()); }
            }
        };
        let _ = reader.join();
        if !status.success() { return Err(format!("Die Analyse ist fehlgeschlagen. Details: {}", output.join("analysis.log").display())); }
    }
    if cancel.load(Ordering::Relaxed) { return Err("Analyse abgebrochen.".into()); }
    let result: Value = serde_json::from_slice(&fs::read(manifest).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    app.asset_protocol_scope().allow_directory(&output, false).map_err(|e| e.to_string())?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selected_region_is_bounded() {
        assert!(validate_range(5., 10.).is_ok());
        for (a, b) in [(0., 181.), (-1., 1.), (5., 4.), (0., f64::NAN), (0., f64::INFINITY)] { assert!(validate_range(a, b).is_err()); }
    }
}
