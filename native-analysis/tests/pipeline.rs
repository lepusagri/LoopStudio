use std::{fs, process::Command};

#[test]
#[ignore = "Requires LOOPSTUDIO_TEST_RUNTIME with native libraries and Demucs weights"]
fn native_passage_produces_six_stems_and_bounded_notes() {
    let home = std::env::var("LOOPSTUDIO_TEST_RUNTIME").unwrap();
    let work = tempfile::tempdir().unwrap();
    let input = work.path().join("synthetic-guitar.wav");
    let spec = hound::WavSpec {channels:2,sample_rate:44100,bits_per_sample:32,sample_format:hound::SampleFormat::Float};
    let mut writer=hound::WavWriter::create(&input,spec).unwrap();
    for i in 0..4*44100 {
        let step = i / 22050;
        let t=(i % 22050) as f32/44100.;
        let frequency=[110.,146.8324,164.8138,220.][step % 4];
        let envelope=(1.-(-t*1200.).exp())*(-t*6.).exp();
        let sample=(1..=8).map(|h| (t*std::f32::consts::TAU*frequency*h as f32).sin()/(h as f32).powf(1.5)).sum::<f32>()*envelope*0.3;
        writer.write_sample(sample).unwrap();writer.write_sample(sample*0.85).unwrap();
    }
    writer.finalize().unwrap();
    let output=work.path().join("result");
    let status=Command::new(env!("CARGO_BIN_EXE_loopstudio-analysis")).arg("--source").arg(input)
        .args(["--start","1","--end","3","--home"]).arg(home).arg("--output").arg(&output)
        .arg("--device").arg(std::env::var("LOOPSTUDIO_TEST_DEVICE").unwrap_or("cpu".into()))
        .arg("--transcriber").arg(std::env::var("LOOPSTUDIO_TEST_TRANSCRIBER").unwrap_or("basic-pitch".into()))
        .status().unwrap();
    assert!(status.success());
    let result:serde_json::Value=serde_json::from_slice(&fs::read(output.join("result.json")).unwrap()).unwrap();
    assert_eq!(result["engine"],"rust");assert_eq!(result["start"],1.);
    assert!((result["end"].as_f64().unwrap()-3.).abs()<0.01);
    let stems=result["stems"].as_array().unwrap();assert_eq!(stems.len(),6);
    let mut total=0;
    for (i,stem) in stems.iter().enumerate() {
        assert_eq!(stem["id"],i);
        let mut wav=hound::WavReader::open(stem["path"].as_str().unwrap()).unwrap();
        assert_eq!(wav.spec().channels,2);assert_eq!(wav.spec().sample_rate,44100);
        assert_eq!(wav.duration(),88200);
        assert!(wav.samples::<f32>().all(|s|s.unwrap().is_finite()));
        for note in stem["notes"].as_array().unwrap() {
            let start=note["time"].as_f64().unwrap();let duration=note["duration"].as_f64().unwrap();
            assert!(start>=0. && duration>0. && start+duration<=2.0001);
            assert_eq!(note["track"],i);total+=1;
        }
    }
    assert!(total>0,"The plucked-note fixture should produce notes in at least one stem");
    assert!(stems[0]["notes"].as_array().unwrap().is_empty());
}
