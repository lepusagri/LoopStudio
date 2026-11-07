use serde::Serialize;
use std::{fs, process::{Command, Stdio}};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct RhythmResult { bpm: f64, first_beat: f64, confidence: f64, beats: Vec<f64> }

pub fn estimate(samples: &[f32]) -> Result<RhythmResult,String> {
    // 10 ms energy windows emphasize attacks rather than sustained tones.
    let energy: Vec<f64> = samples.chunks(220).map(|frame| (frame.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / frame.len() as f64).sqrt()).collect();
    if energy.len()<400 { return Err("Für die Rhythmusschätzung bitte mindestens vier Sekunden auswählen.".into()); }
    let mut envelope=Vec::with_capacity(energy.len());
    for (i,e) in energy.iter().enumerate() {
        let mean=energy[i.saturating_sub(15)..=i].iter().sum::<f64>() / (i.min(15)+1) as f64;
        envelope.push((e-mean).max(0.0));
    }
    let norm=envelope.iter().map(|v|v*v).sum::<f64>();
    if norm<1e-10 { return Err("Zu wenig rhythmische Anschläge erkannt. BPM bitte von Hand einstellen.".into()); }
    let scores: Vec<(usize,f64)>= (25..=150).map(|lag| {
        let value=envelope.iter().skip(lag).zip(&envelope).map(|(a,b)|a*b).sum::<f64>() / norm;
        (lag,value)
    }).collect();
    // Prefer the shortest strongly supported period; long multiples share the same pulse.
    let best=scores.iter().map(|(_,s)|*s).fold(0.0,f64::max);
    let &(lag,confidence)=scores.iter().filter(|(_,s)|*s>=best*0.95).next().ok_or("Kein Tempo gefunden")?;
    if confidence<0.08 { return Err("Kein ausreichend regelmäßiger Puls gefunden. BPM bitte von Hand einstellen.".into()); }
    let step=220.0/22050.0;
    let mut period=lag as f64;
    let index=lag-25;
    if index>0&&index+1<scores.len(){let a=scores[index-1].1;let b=scores[index].1;let c=scores[index+1].1;let d=a-2.0*b+c;if d.abs()>1e-8{period+=(0.5*(a-c)/d).clamp(-0.5,0.5);}}
    let phase=(0..lag).max_by(|a,b| {
        let score=|phase:usize| (phase..envelope.len()).step_by(lag).map(|i|envelope[i]).sum::<f64>();
        score(*a).total_cmp(&score(*b))
    }).unwrap_or(0) as f64*step;
    let seconds=samples.len() as f64/22050.0;
    let interval=period*step;
    let beats=(0..).map(|i|phase+i as f64*interval).take_while(|t|*t<seconds).collect();
    Ok(RhythmResult{bpm:60.0/interval,first_beat:phase,confidence,beats})
}

#[tauri::command]
pub async fn analyze_loop_rhythm(source:String,start:f64,end:f64)->Result<RhythmResult,String>{
    if !start.is_finite()||!end.is_finite()||start<0.0||!(4.0..=180.0).contains(&(end-start)){return Err("Bitte einen Loop zwischen 4 Sekunden und 3 Minuten wählen.".into());}
    tauri::async_runtime::spawn_blocking(move||{
        let source=fs::canonicalize(source).map_err(|e|e.to_string())?;
        let ffmpeg=crate::analysis::runtime_dir()?.join("runtime/ffmpeg.exe");
        let mut cmd=Command::new(ffmpeg);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let out=cmd.args(["-nostdin","-v","error","-ss"]).arg(start.to_string()).arg("-i").arg(source).arg("-t").arg((end-start).to_string()).args(["-vn","-ac","1","-ar","22050","-f","f32le","pipe:1"]).stdin(Stdio::null()).output().map_err(|e|e.to_string())?;
        if !out.status.success(){return Err("Die Audiospur konnte für die Rhythmusschätzung nicht gelesen werden.".into());}
        let samples:Vec<f32>=out.stdout.chunks_exact(4).map(|c|f32::from_le_bytes(c.try_into().unwrap())).collect();
        if samples.iter().any(|v|!v.is_finite()){return Err("Ungültige Audiodaten".into());}
        estimate(&samples)
    }).await.map_err(|e|e.to_string())?
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn detects_pulse_with_leading_silence(){
        let mut audio=vec![0.0;22050*12];
        for beat in 0..23 {let start=5512+beat*11025;for i in 0..500{audio[start+i]=(1.0-i as f32/500.0)*if i%2==0{1.0}else{-1.0};}}
        let result=estimate(&audio).unwrap();
        assert!((result.bpm-120.0).abs()<2.0,"{}",result.bpm);
        assert!((result.first_beat-0.25).abs()<0.04);
    }
    #[test] fn rejects_silence(){assert!(estimate(&vec![0.0;22050*8]).is_err());}
}
