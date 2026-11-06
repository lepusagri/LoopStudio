use crate::{analysis, fingering::{self, NoteEvent, Arrangement, Engine}, tab::Tuning};
use std::{path::Path, sync::Mutex};
use tauri::Manager;

// Model downloads and inference are bounded and serialized across both players.
static JOB: Mutex<()> = Mutex::new(());
// ort permits exactly one Environment during the process lifetime, even after Drop.
static ENVIRONMENT: Mutex<Option<ort::environment::Environment>> = Mutex::new(None);

fn calculate(notes: &[NoteEvent], runtime: &Path, cache: &Path) -> anyhow::Result<Arrangement> {
    anyhow::ensure!(notes.len() <= 20000, "Maximal 20.000 Noten pro Griffberechnung. Bitte eine kleinere MIDI-Datei laden.");
    for n in notes {
        anyhow::ensure!(n.pitch <= 127 && n.start_s.is_finite() && n.end_s.is_finite() && n.amplitude.is_finite()
            && n.start_s >= 0. && n.end_s > n.start_s && n.end_s <= 86400., "Ungültige Notendaten");
    }
    let _guard = JOB.lock().map_err(|_| anyhow::anyhow!("Griffberechnung nicht verfügbar"))?;
    let library = runtime.join("runtime/onnxruntime.dll");
    anyhow::ensure!(library.is_file(), "ONNX Runtime fehlt. Bitte setup-analysis.ps1 ausführen.");
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    hash.update(fingering::REVISION); hash.update(serde_json::to_vec(notes)?);
    let results = cache.join("results"); std::fs::create_dir_all(&results)?;
    let path = results.join(format!("{:x}.json", hash.finalize()));
    if let Ok(bytes) = std::fs::read(&path) {
        if let Ok(result) = serde_json::from_slice::<Arrangement>(&bytes) { return Ok(result); }
    }
    let mut shared = ENVIRONMENT.lock().map_err(|_| anyhow::anyhow!("ONNX-Umgebung nicht verfügbar"))?;
    if shared.is_none() { *shared = Some(ort::init_from(library)?.with_name("loopstudio-fingering").with_telemetry(false).build()?); }
    let result = fingering::run(notes, Tuning::Standard, Engine::V3, cache, shared.as_ref().unwrap())?;
    let mut temporary = tempfile::NamedTempFile::new_in(&results)?;
    std::io::Write::write_all(&mut temporary, &serde_json::to_vec(&result)?)?;
    temporary.persist(&path).map_err(|e| e.error)?;
    Ok(result)
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
        let cache=tempfile::tempdir().unwrap();
        let weights=Path::new(&runtime).join("models").join(fingering::MODEL);
        if weights.is_file(){std::fs::create_dir_all(cache.path().join("models")).unwrap();std::fs::copy(weights,cache.path().join("models").join(fingering::MODEL)).unwrap();}
        let result = calculate(&notes, Path::new(&runtime), cache.path()).unwrap();
        assert_eq!(result.notes.len(), notes.len());
        assert!(result.unassigned.is_empty());
        // Different inputs force a second actual model run in this same process.
        let second = [NoteEvent {pitch:70,start_s:0.125,end_s:0.525,amplitude:0.73}];
        let next = calculate(&second, Path::new(&runtime), cache.path()).unwrap();
        assert_eq!(next.notes.len(),1);
        for n in result.notes {
            assert_eq!([64,59,55,50,45,40][n.string as usize - 1] + n.fret, notes[n.index].pitch);
        }
    }
}
