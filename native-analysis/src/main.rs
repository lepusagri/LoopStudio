#![deny(unsafe_op_in_unsafe_fn)]
#![allow(dead_code)] // Shared, tested AutoTab backend also exposes MIDI-export helpers.
mod audio;
mod inference;
mod instruments;
mod intel_gpu;
mod muscriptor;
mod rhythm;
mod separation;
mod tools;

use anyhow::{Context, Result, ensure};
use basic_pitch::{BasicPitch, TrimMode, NoteEvent};
use clap::Parser;
use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}, process::{Command, Stdio}, sync::Arc};

#[derive(Parser)]
struct Args {
    #[arg(long)] source: PathBuf,
    #[arg(long)] start: f64,
    #[arg(long)] end: f64,
    #[arg(long)] output: PathBuf,
    #[arg(long)] home: PathBuf,
    #[arg(long, value_enum, default_value="basic-pitch")] transcriber: muscriptor::Transcriber,
    #[arg(long, value_enum, default_value="auto")] device: inference::Device,
    #[arg(long)] muscriptor_model: Option<PathBuf>,
}

pub fn progress(message: &str, percent: u32) {
    println!("{}", json!({"message":message,"percent":percent}));
}

fn main() {
    if let Err(e) = run(Args::parse()) {
        // Never include HF_TOKEN in command lines or diagnostics.
        let mut message = format!("{e:#}");
        if let Ok(token) = std::env::var("HF_TOKEN") { if !token.is_empty() { message = message.replace(&token, "[Token]"); } }
        eprintln!("{message}"); std::process::exit(1);
    }
}

fn crop(args: &Args, ffmpeg: &Path) -> Result<Vec<f32>> {
    let mut command = Command::new(ffmpeg);
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let status = command.args(["-nostdin","-v","error","-y","-ss"]).arg(args.start.to_string())
        .arg("-i").arg(&args.source).arg("-t").arg((args.end-args.start).to_string())
        .args(["-map","0:a:0","-vn","-ac","2","-ar","44100","-c:a","pcm_f32le"])
        .arg(args.output.join("passage.wav")).stdin(Stdio::null()).output().context("FFmpeg konnte nicht gestartet werden")?;
    ensure!(status.status.success(), "FFmpeg: {}", String::from_utf8_lossy(&status.stderr));
    audio::decode(ffmpeg, &args.output.join("passage.wav"), 44100, 2)
}

fn note_json(n: &NoteEvent, duration: f64, track: usize) -> Option<Value> {
    let begin = n.start_s.max(0.); let end = n.end_s.min(duration);
    (begin.is_finite() && end.is_finite() && end > begin && n.pitch <= 127 && n.amplitude.is_finite()).then(|| json!({
        "midi":n.pitch,"time":begin,"duration":end-begin,"velocity":n.amplitude.clamp(0.,1.),"track":track
    }))
}

fn run(args: Args) -> Result<()> {
    ensure!(args.start.is_finite() && args.end.is_finite() && args.start >= 0. && (0.1..=180.).contains(&(args.end-args.start)), "Passage muss zwischen 0,1 und 180 Sekunden liegen");
    ensure!(args.source.is_file(), "Mediendatei fehlt");
    let model = args.home.join("models/htdemucs_6s.onnx");
    ensure!(model.is_file(), "Demucs-ONNX-Modell fehlt. setup-analysis.ps1 ausführen.");
    fs::create_dir_all(&args.output)?;
    let ffmpeg = tools::find_ffmpeg(&args.home)?;
    let device = args.device.resolve(&args.home);
    let config = inference::Config {
        device, gpu_id:0, precision:inference::Precision::Fp32, threads:4,
        cache:args.home.join(".cache/openvino"), profiles:None,
        openvino_library:args.home.join("runtime/openvino-2026.4.1/openvino_c.dll")
    };
    if args.transcriber.variant().is_some() {
        ensure!(config.openvino_library.is_file(), "MuScriptor benötigt OpenVINO. setup-analysis.ps1 ohne -CpuOnly ausführen.");
    }
    progress("Gewählte Passage wird gelesen …", 3);
    let mix = crop(&args, &ffmpeg)?;
    let duration = mix.len() as f64 / 88200.;
    ensure!(duration >= 0.05 && duration <= 180.1, "Ungültige Audiodauer");
    let environment = ort::init_from(device.runtime(&args.home))?.with_name("loopstudio-native").with_telemetry(false).build()?;
    progress("Demucs trennt sechs Instrumentenspuren …", 10);
    let separated = separation::stems(&environment, &model, &mix, &config)?;
    let names = [("drums","Schlagzeug"),("bass","Bass"),("other","Weitere Instrumente"),("vocals","Gesang"),("guitar","Gitarre"),("piano","Piano")];
    let mut stems = Vec::new();
    // Load a model once for all five pitched stems.
    let basic = if args.transcriber.variant().is_none() { Some(Arc::new(inference::PitchBackend::new(&environment,&config)?)) } else {None};
    for (id, samples) in separated.iter().enumerate() {
        let (source,name) = names[id];
        let path = args.output.join(format!("{source}.wav"));
        audio::write_stereo(&path, samples)?;
        let rms = (samples.iter().map(|&s| (s as f64).powi(2)).sum::<f64>() / samples.len() as f64).sqrt();
        let mut notes = Vec::new(); let mut warning = None::<String>;
        progress(&format!("Noten erkennen: {name} …"), 52 + id as u32 * 7);
        if id == 0 { warning = Some("Schlagzeug enthält keine Tonhöhen für Griffbrett oder Klavier.".into()); }
        else if rms < 0.00005 { warning = Some("Diese Spur ist nahezu still; keine Noten erkannt.".into()); }
        else if let Some(variant) = args.transcriber.variant() {
            let mono = audio::decode(&ffmpeg,&path,16000,1)?;
            let selection = match source { "guitar" => "4,5,6", "piano" => "0", "bass" => "7,8", _ => "auto" }.parse::<instruments::Instruments>().map_err(anyhow::Error::msg)?;
            // Errors stay visible; a selected model is never silently replaced.
            let recognized = muscriptor::transcribe(variant,&mono,&args.home,args.muscriptor_model.as_deref(),&config,&selection)?;
            notes = recognized.notes.iter().filter_map(|n| note_json(&n.note,duration,id)).collect();
        } else if let Some(backend) = &basic {
            let mono = audio::decode(&ffmpeg,&path,22050,1)?;
            let recognized = BasicPitch::with_backend(backend.clone()).with_trim_mode(TrimMode::V0_4_0).transcribe(&mono)?;
            notes = recognized.notes.iter().filter_map(|n|note_json(n,duration,id)).collect();
        }
        notes.sort_by(|a,b| a["time"].as_f64().unwrap().total_cmp(&b["time"].as_f64().unwrap()));
        if notes.is_empty() && warning.is_none() { warning=Some("Keine sicheren Noten erkannt. Die Audiospur ist trotzdem abspielbar.".into()); }
        stems.push(json!({"id":id,"source":source,"name":name,"path":fs::canonicalize(&path)?.to_string_lossy(),"rms":rms,"notes":notes,"warning":warning}));
    }
    let result = json!({"version":2,"engine":"rust","transcriber":format!("{:?}",args.transcriber),"device":format!("{:?}",device),"start":args.start,"end":args.start+duration,"stems":stems});
    let temporary = args.output.join("result.tmp");
    fs::write(&temporary,serde_json::to_vec(&result)?)?;
    fs::rename(temporary,args.output.join("result.json"))?;
    progress("Spuren und Noten sind bereit.",100);
    Ok(())
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn output_notes_are_clipped_to_passage_without_changing_pitch() {
        let note=NoteEvent{pitch:64,start_s:0.2,end_s:4.,amplitude:0.8,start_frame:0,end_frame:0,pitch_bends:None};
        let value=note_json(&note,1.,4).unwrap();
        assert_eq!(value["midi"],64); assert_eq!(value["track"],4);
        assert_eq!(value["duration"],0.8); assert!(note_json(&note,0.1,4).is_none());
    }
}
