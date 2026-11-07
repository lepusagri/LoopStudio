#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{fs, sync::Mutex};
use tauri::Manager;
#[path = "../../shared/platform_paths.rs"]
mod platform_paths;
mod analysis;
mod global_settings;
mod rhythm_analysis;
mod projects;
#[cfg(not(feature = "python-tab-tools"))]
mod tab_tools;
#[cfg(feature = "python-tab-tools")]
#[path = "tab_tools_python.rs"]
mod tab_tools;
mod loop_material;
mod fingering;
mod fingering_command;
mod tab;
mod external_editor;
mod installer;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PracticeLoop { id: String, name: String, start: f64, end: f64, #[serde(default, skip_serializing_if="Option::is_none")] material_id: Option<String>, #[serde(default, skip_serializing_if="Option::is_none")] rhythm: Option<LoopRhythm> }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoopRhythm { bpm: Option<f64>, beats_per_bar: u8, beat_unit: u8, bars: Option<u16>, #[serde(default, skip_serializing_if="Option::is_none")] first_beat: Option<f64>, #[serde(default, skip_serializing_if="Option::is_none")] confidence: Option<f64> }

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
        if !item.start.is_finite() || !item.end.is_finite() || item.start < 0.0 || item.end <= item.start || item.name.len() > 200 || item.id.len() > 100 || item.material_id.as_ref().is_some_and(|s|s.len()!=64 || !s.bytes().all(|b|b.is_ascii_hexdigit())) || item.rhythm.as_ref().is_some_and(|r| r.bpm.is_some_and(|bpm| !bpm.is_finite() || !(20.0..=400.0).contains(&bpm)) || !(1..=32).contains(&r.beats_per_bar) || ![1,2,4,8,16,32].contains(&r.beat_unit) || r.first_beat.is_some_and(|v| !v.is_finite() || v < 0.0 || v > item.end-item.start) || r.confidence.is_some_and(|v| !v.is_finite() || !(0.0..=1.0).contains(&v)) || r.bars.is_some_and(|bars| bars == 0 || bars > 512)) {
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
        .setup(|app| {
            platform_paths::install_resources(&app.path().resource_dir()?, &app.path().app_data_dir()?)?;
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .manage(StorageLock::default())
        .manage(projects::ProjectsState::default())
        .manage(analysis::AnalysisState::default())
        .manage(tab_tools::ToolsState::default())
        .on_window_event(|window, event| { if matches!(event, tauri::WindowEvent::Destroyed) { analysis::stop(window.state::<analysis::AnalysisState>());tab_tools::stop(window.state::<tab_tools::ToolsState>()); } })
        .invoke_handler(tauri::generate_handler![installer::install_standard_models, external_editor::guitar_pro_path, external_editor::set_guitar_pro_path, external_editor::export_external_score, external_editor::read_external_score, external_editor::launch_external_score, global_settings::load_global_settings, global_settings::save_global_settings, rhythm_analysis::analyze_loop_rhythm, load_sessions, save_sessions, projects::list_projects, projects::default_project_dir, projects::open_project, projects::create_project, projects::save_project, projects::save_project_material, projects::load_project_material, tab_tools::tab_tools_status, tab_tools::stage_tab_input, tab_tools::prepare_tab_video, tab_tools::extract_tab_frame, tab_tools::compose_tab_pdf, tab_tools::run_tab_tool, tab_tools::cancel_tab_tool, tab_tools::save_tab_artifact, loop_material::save_loop_material, loop_material::load_loop_material, analysis::find_cached_analysis, fingering_command::assign_fingerings, analysis::analysis_ready, analysis::stage_media, analysis::analyze_passage, analysis::cancel_analysis])
        .run(tauri::generate_context!())
        .expect("LoopStudio konnte nicht gestartet werden");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn existing_loop_sessions_load_without_attachment_and_new_links_survive_roundtrip() {
        let old=r#"{"key":"song.mp4","loops":[{"id":"loop","name":"Verse","start":8,"end":10}],"speed":1,"offset":0}"#;
        let mut session:PracticeSession=serde_json::from_str(old).unwrap();
        assert!(session.loops[0].material_id.is_none());
        session.loops[0].material_id=Some("a".repeat(64));
        assert!(validate_session(&session).is_ok());
        let restored:PracticeSession=serde_json::from_slice(&serde_json::to_vec(&session).unwrap()).unwrap();
        assert_eq!(restored.loops[0].material_id,Some("a".repeat(64)));
    }
    #[test]
    fn invalid_loop_is_rejected() {
        let mut session = PracticeSession { key: "song".into(), speed: 1.0, offset: 0.0, loops: vec![PracticeLoop {id:"1".into(),name:"Intro".into(), start:3.0,end:2.0,material_id:None,rhythm:None}] };
        assert!(validate_session(&session).is_err());
        session.loops[0].end = 5.0;
        assert!(validate_session(&session).is_ok());
        session.speed = f64::NAN;
        assert!(validate_session(&session).is_err());
    }
    #[test]
    fn loop_rhythm_survives_session_roundtrip() {
        let old = r#"{"key":"song.mp4","loops":[{"id":"one","name":"Verse","start":1,"end":9}],"speed":1,"offset":0}"#;
        let mut session: PracticeSession = serde_json::from_str(old).unwrap();
        assert!(session.loops[0].rhythm.is_none());
        session.loops[0].rhythm = Some(LoopRhythm { bpm: Some(120.0), beats_per_bar: 4, beat_unit: 4, bars: Some(4), first_beat: Some(0.25), confidence: Some(0.8) });
        let restored: PracticeSession = serde_json::from_slice(&serde_json::to_vec(&session).unwrap()).unwrap();
        assert_eq!(restored.loops[0].rhythm.as_ref().unwrap().bars, Some(4));
        assert!(validate_session(&restored).is_ok());
    }
}
