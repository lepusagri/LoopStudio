use crate::{analysis, fingering::{self, NoteEvent, Arrangement, Engine}, tab::Tuning};
use std::{path::Path, sync::Mutex};
use tauri::Manager;

// Model downloads and inference are bounded and serialized across both players.
static JOB: Mutex<()> = Mutex::new(());

fn calculate(notes: &[NoteEvent], runtime: &Path, cache: &Path) -> anyhow::Result<Arrangement> {
    anyhow::ensure!(notes.len() <= 20000, "Maximal 20.000 Noten pro Griffberechnung. Bitte eine kleinere MIDI-Datei laden.");
    for n in notes {
        anyhow::ensure!(n.pitch <= 127 && n.start_s.is_finite() && n.end_s.is_finite() && n.amplitude.is_finite()
            && n.start_s >= 0. && n.end_s > n.start_s && n.end_s <= 86400., "Ungültige Notendaten");
    }
    let _guard = JOB.lock().map_err(|_| anyhow::anyhow!("Griffberechnung nicht verfügbar"))?;
    let library = runtime.join("Lib/site-packages/onnxruntime/capi/onnxruntime.dll");
    anyhow::ensure!(library.is_file(), "ONNX Runtime fehlt. Bitte setup-analysis.ps1 ausführen.");
    let environment = ort::init_from(library)?.with_name("loopstudio-fingering").with_telemetry(false).build()?;
    fingering::run(notes, Tuning::Standard, Engine::V3, cache, &environment)
}

#[tauri::command]
pub async fn assign_fingerings(app: tauri::AppHandle, notes: Vec<NoteEvent>) -> Result<Arrangement, String> {
    let runtime = analysis::runtime_dir()?;
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("fingering-v3");
    tauri::async_runtime::spawn_blocking(move || calculate(&notes, &runtime, &cache).map_err(|e| format!("Griffberechnung: {e:#}")))
        .await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Requires LOOPSTUDIO_TEST_RUNTIME; downloads the verified 1.3 MB model once"]
    fn native_model_assigns_exactly_one_position_per_note() {
        let runtime = std::env::var("LOOPSTUDIO_TEST_RUNTIME").unwrap();
        let notes = [48, 52, 55, 64, 67, 69].into_iter().enumerate().map(|(i,pitch)| NoteEvent {
            pitch, start_s: i as f64 * 0.5, end_s: i as f64 * 0.5 + 0.4, amplitude: 0.8
        }).collect::<Vec<_>>();
        let result = calculate(&notes, Path::new(&runtime), Path::new(&runtime)).unwrap();
        assert_eq!(result.notes.len(), notes.len());
        assert!(result.unassigned.is_empty());
        for n in result.notes {
            assert_eq!([64,59,55,50,45,40][n.string as usize - 1] + n.fret, notes[n.index].pitch);
        }
    }
}
