use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
const WORKER: &str = include_str!("../../tooling/tab_worker.py");
#[derive(Default)]
pub struct ToolsState {
    active: Mutex<Option<(String, Arc<AtomicBool>)>>,
}
fn runtime() -> Result<PathBuf, String> {
    let adjacent = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("Programmordner fehlt")?
        .join("LoopStudio-tools-runtime");
    let configured = std::env::var_os("LOOPSTUDIO_TOOLS_RUNTIME").map(PathBuf::from);
    configured
        .into_iter()
        .chain(crate::platform_paths::installed("LoopStudio-tools-runtime"))
        .chain([
            adjacent,
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../LoopStudio-tools-runtime"),
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../LoopStudio-tools-runtime"),
        ])
        .find(|p| crate::platform_paths::python(p).is_file())
        .ok_or("Python-Tab-Werkzeuge fehlen. setup-tab-tools-python.ps1 ausführen.".into())
}
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() < 80 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
#[tauri::command]
pub fn tab_tools_status() -> Value {
    match runtime() {
        Ok(r) => {
            json!({"backend":"Python","setupScript":"setup-tab-tools-python.ps1","pdf":r.join("pdf-to-gp5/app/converter.py").exists(),"omr":r.join("omr/model/best.pt").exists()&&r.join("omr/scripts/guitar_omr_eval.py").exists()})
        }
        Err(_) => json!({"pdf":false,"omr":false,"backend":"Python","setupScript":"setup-tab-tools-python.ps1"}),
    }
}
#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
fn valid_crop(c: Crop) -> bool {
    [c.x, c.y, c.width, c.height].iter().all(|n| n.is_finite())
        && c.x >= 0.
        && c.y >= 0.
        && c.width >= 0.01
        && c.height >= 0.01
        && c.x + c.width <= 1.00001
        && c.y + c.height <= 1.00001
}
#[tauri::command]
pub fn prepare_tab_video(app: tauri::AppHandle, source: String) -> Result<String, String> {
    let path = fs::canonicalize(source).map_err(|e| e.to_string())?;
    if !path.is_file() {
        return Err("Video fehlt".into());
    }
    app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn compose_tab_pdf(
    app: tauri::AppHandle,
    sources: Vec<String>,
    destination: Option<String>,
) -> Result<String, String> {
    if sources.is_empty() || sources.len() > 8 {
        return Err("Bitte 1 bis 8 Bildausschnitte wählen.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let frames = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("tab-tools/frames");
        let inputs=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("tab-tools/inputs");
        let roots:Vec<_>=[frames,inputs].into_iter().filter_map(|p|fs::canonicalize(p).ok()).collect();
        let mut paths = Vec::with_capacity(sources.len());
        for source in sources {
            let path = fs::canonicalize(source).map_err(|e| e.to_string())?;
            if !roots.iter().any(|root|path.parent()==Some(root.as_path())) || path.extension().and_then(|v| v.to_str()) != Some("png") {
                return Err("Ungültiger Bildausschnitt".into());
            }
            paths.push(path);
        }
        let output = if let Some(destination) = destination {
            let path = PathBuf::from(destination);
            if path.extension().and_then(|v| v.to_str()).is_none_or(|ext| !ext.eq_ignore_ascii_case("pdf")) {
                return Err("Bitte eine PDF-Datei wählen.".into());
            }
            path
        } else {
            let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("tab-tools/documents");
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let key = paths.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>().join("|");
            dir.join(format!("{:x}.pdf", Sha256::digest(key.as_bytes())))
        };
        let script = r#"import sys
from PIL import Image
items = []
for name in sys.argv[2:]:
    with Image.open(name) as image:
        items.append(image.convert('RGB'))
gap = 60
width = max(image.width for image in items) + 80
height = sum(image.height for image in items) + gap * (len(items) + 1)
if width * height > 20_000_000:
    raise ValueError('Die zusammengesetzte PDF-Seite ist zu groß (maximal 20 Megapixel).')
page = Image.new('RGB', (width, height), 'white')
y = gap
for image in items:
    page.paste(image, (40, y))
    y += image.height + gap
page.save(sys.argv[1], 'PDF', resolution=150)
"#;
        let mut cmd = Command::new(crate::platform_paths::python(&runtime()?));
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let result = cmd.arg("-c").arg(script).arg(&output).args(&paths).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
        if !result.status.success() {
            let stderr = String::from_utf8_lossy(&result.stderr);
            return Err(stderr.lines().last().unwrap_or("PDF konnte nicht erstellt werden.").to_owned());
        }
        app.asset_protocol_scope().allow_file(&output).map_err(|e| e.to_string())?;
        Ok(output.to_string_lossy().into_owned())
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn stage_tab_input(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Value, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Datei erwartet".into());
    };
    if bytes.len() > 40 * 1024 * 1024 {
        return Err("Maximal 40 MB pro Datei".into());
    }
    let ext = if bytes.starts_with(b"%PDF-") {
        "pdf"
    } else if bytes.starts_with(b"\x89PNG") {
        "png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "jpg"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "webp"
    } else {
        return Err("Bitte PDF, PNG, JPEG oder WebP auswählen.".into());
    };
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("tab-tools/inputs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{:x}.{ext}", Sha256::digest(bytes)));
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;
    Ok(json!({"path":path,"kind":ext}))
}
#[tauri::command]
pub async fn extract_tab_frame(
    app: tauri::AppHandle,
    source: String,
    time: f64,
    crop: Option<Crop>,
) -> Result<String, String> {
    if !time.is_finite() || !(0.0..=86400.).contains(&time) || crop.is_some_and(|c| !valid_crop(c))
    {
        return Err("Ungültige Zeit oder Bildauswahl".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let source = fs::canonicalize(source).map_err(|e| e.to_string())?;
        if !source.is_file() {
            return Err("Video fehlt".into());
        }
        let dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("tab-tools/frames");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let name = format!(
            "{:x}",
            Sha256::digest(
                format!(
                    "{}:{:?}:{time}:{}",
                    source.display(),
                    source.metadata().ok().and_then(|m| m.modified().ok()),
                    serde_json::to_string(&crop).unwrap()
                )
                .as_bytes()
            )
        );
        let path = dir.join(format!("{name}.png"));
        if !path.exists() {
            let ffmpeg = crate::analysis::runtime_dir()?.join("runtime").join(crate::platform_paths::binary("ffmpeg"));
            let mut cmd = Command::new(ffmpeg);
            #[cfg(windows)]
            cmd.creation_flags(0x08000000);
            cmd.args(["-nostdin", "-v", "error", "-ss"])
                .arg(time.to_string())
                .arg("-i")
                .arg(source);
            if let Some(c) = crop {
                cmd.arg("-vf").arg(format!(
                    "crop=iw*{}:ih*{}:iw*{}:ih*{}",
                    c.width, c.height, c.x, c.y
                ));
            }
            let result = cmd
                .args(["-frames:v", "1", "-y"])
                .arg(&path)
                .stdin(Stdio::null())
                .output()
                .map_err(|e| e.to_string())?;
            if !result.status.success() || !path.exists() {
                return Err(format!(
                    "Videobild konnte nicht gelesen werden: {}",
                    String::from_utf8_lossy(&result.stderr)
                ));
            }
        }
        app.asset_protocol_scope()
            .allow_file(&path)
            .map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}
pub fn stop(state: tauri::State<ToolsState>) {
    if let Ok(active) = state.active.lock() {
        if let Some((_, cancel)) = active.as_ref() {
            cancel.store(true, Ordering::Relaxed);
        }
    }
}
#[tauri::command]
pub fn cancel_tab_tool(state: tauri::State<ToolsState>, job_id: String) {
    if let Ok(active) = state.active.lock() {
        if let Some((id, cancel)) = active.as_ref() {
            if *id == job_id {
                cancel.store(true, Ordering::Relaxed);
            }
        }
    }
}
#[tauri::command]
pub async fn run_tab_tool(
    app: tauri::AppHandle,
    source: String,
    engine: String,
    bpm: u16,
    job_id: String,
    numerator: Option<u8>,
    denominator: Option<u8>,
) -> Result<Value, String> {
    if !["pdf", "omr"].contains(&engine.as_str())
        || !valid_id(&job_id)
        || !(20..=400).contains(&bpm)
    {
        return Err("Ungültiger Werkzeugauftrag".into());
    }
    if numerator.is_some()!=denominator.is_some() || numerator.is_some_and(|n|!(1..=32).contains(&n)) || denominator.is_some_and(|d|![1,2,4,8,16,32].contains(&d)){return Err("Ungültige Taktart".into());}
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<ToolsState>();
        let mut active = state.active.lock().map_err(|e| e.to_string())?;
        if active.is_some() {
            return Err("Ein Tab-Werkzeug läuft bereits.".into());
        }
        *active = Some((job_id.clone(), cancel.clone()));
    }
    let task_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run(&task_app, &source, &engine, bpm, &job_id, cancel, numerator.zip(denominator))
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|v| v);
    if let Ok(mut active) = app.state::<ToolsState>().active.lock() {
        *active = None;
    }
    result
}
fn run(
    app: &tauri::AppHandle,
    source: &str,
    engine: &str,
    bpm: u16,
    job_id: &str,
    cancel: Arc<AtomicBool>,
    meter: Option<(u8,u8)>,
) -> Result<Value, String> {
    let runtime = runtime()?;
    let input = Path::new(source);
    let meta = input.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > 40 * 1024 * 1024 {
        return Err("Eingabe fehlt oder überschreitet 40 MB.".into());
    }
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("tab-tools/jobs")
        .join(job_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let worker = dir.join("worker.py");
    fs::write(&worker, WORKER).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(crate::platform_paths::python(&runtime));
    cmd.arg("-u")
        .arg(worker)
        .arg("--engine")
        .arg(engine)
        .arg("--source")
        .arg(input)
        .arg("--runtime")
        .arg(runtime)
        .arg("--output")
        .arg(&dir)
        .arg("--bpm")
        .arg(bpm.to_string())
        .env("PYTHONUTF8", "1")
        .env("ORT_DISABLE_TELEMETRY", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(fs::File::create(dir.join("tool.log")).map_err(|e| e.to_string())?);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    if let Some((n,d))=meter{cmd.arg("--numerator").arg(n.to_string()).arg("--denominator").arg(d.to_string());}
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let out = child.stdout.take().ok_or("Werkzeugausgabe fehlt")?;
    let notify = app.clone();
    let id = job_id.to_owned();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                let _ = notify.emit(
                    "tab-tool-progress",
                    json!({"jobId":id,"message":value["message"],"percent":value["percent"]}),
                );
            }
        }
    });
    let began = Instant::now();
    let status = loop {
        if cancel.load(Ordering::Relaxed) || began.elapsed() > Duration::from_secs(300) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err("Tab-Werkzeug abgebrochen oder Zeitlimit erreicht.".into());
        }
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e.to_string());
            }
        }
    };
    let _ = reader.join();
    if !status.success() {
        let log = fs::read_to_string(dir.join("tool.log")).unwrap_or_default();
        return Err(log.lines().rev().find(|line| !line.trim().is_empty())
            .unwrap_or("Tab-Werkzeug fehlgeschlagen. Bitte den Bildausschnitt prüfen.")
            .to_owned());
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("Tab-Werkzeug abgebrochen".into());
    }
    let mut result: Value =
        serde_json::from_slice(&fs::read(dir.join("result.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    result["jobId"] = json!(job_id);
    Ok(result)
}
#[tauri::command]
pub fn save_tab_artifact(
    app: tauri::AppHandle,
    job_id: String,
    kind: String,
    destination: String,
) -> Result<(), String> {
    if !valid_id(&job_id) {
        return Err("Ungültiges Ergebnis".into());
    }
    let name = match kind.as_str() {
        "gp5" => "result.gp5",
        "json" => "result.json",
        "tokens" => "tokens.txt",
        _ => return Err("Unbekanntes Dateiformat".into()),
    };
    let source = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("tab-tools/jobs")
        .join(job_id)
        .join(name);
    fs::copy(source, destination).map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crop_and_job_validation() {
        assert!(valid_crop(Crop {
            x: 0.1,
            y: 0.7,
            width: 0.8,
            height: 0.25
        }));
        assert!(!valid_crop(Crop {
            x: 0.9,
            y: 0.,
            width: 0.2,
            height: 1.
        }));
        assert!(!valid_crop(Crop {
            x: f64::NAN,
            y: 0.,
            width: 1.,
            height: 1.
        }));
        assert!(!valid_id("../result"));
        assert!(valid_id("abc-123"));
    }
}
