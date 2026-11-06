#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{fs, sync::Mutex};
use tauri::Manager;
mod analysis;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PracticeLoop { id: String, name: String, start: f64, end: f64 }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PracticeSession { key: String, loops: Vec<PracticeLoop>, speed: f64, offset: f64 }

#[derive(Default)]
struct StorageLock(Mutex<()>);

fn validate_session(session: &PracticeSession) -> Result<(), String> {
    if session.key.len() > 4096 || session.loops.len() > 500 || !(0.25..=2.0).contains(&session.speed) || !session.offset.is_finite() || session.offset.abs() > 86400.0 {
        return Err("Ungültige Übungseinstellungen".into());
    }
    for item in &session.loops {
        if !item.start.is_finite() || !item.end.is_finite() || item.start < 0.0 || item.end <= item.start || item.name.len() > 200 || item.id.len() > 100 {
            return Err("Ungültiger Loop".into());
        }
    }
    Ok(())
}

#[tauri::command]
fn load_sessions(app: tauri::AppHandle, state: tauri::State<StorageLock>) -> Result<Vec<PracticeSession>, String> {
    let _guard = state.0.lock().map_err(|e| e.to_string())?;
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("sessions.json");
    if !path.exists() { return Ok(vec![]); }
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_sessions(app: tauri::AppHandle, state: tauri::State<StorageLock>, sessions: Vec<PracticeSession>) -> Result<(), String> {
    if sessions.len() > 100 { return Err("Maximal 100 Übungsdateien".into()); }
    for session in &sessions { validate_session(session)?; }
    let _guard = state.0.lock().map_err(|e| e.to_string())?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("sessions.json");
    let temporary = dir.join("sessions.tmp");
    fs::write(&temporary, serde_json::to_vec_pretty(&sessions).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(StorageLock::default())
        .manage(analysis::AnalysisState::default())
        .on_window_event(|window, event| { if matches!(event, tauri::WindowEvent::Destroyed) { analysis::stop(window.state::<analysis::AnalysisState>()); } })
        .invoke_handler(tauri::generate_handler![load_sessions, save_sessions, analysis::analysis_ready, analysis::stage_media, analysis::analyze_passage, analysis::cancel_analysis])
        .run(tauri::generate_context!())
        .expect("LoopStudio konnte nicht gestartet werden");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_loop_is_rejected() {
        let mut session = PracticeSession { key: "song".into(), speed: 1.0, offset: 0.0, loops: vec![PracticeLoop {id:"1".into(),name:"Intro".into(), start:3.0,end:2.0}] };
        assert!(validate_session(&session).is_err());
        session.loops[0].end = 5.0;
        assert!(validate_session(&session).is_ok());
        session.speed = f64::NAN;
        assert!(validate_session(&session).is_err());
    }
}
