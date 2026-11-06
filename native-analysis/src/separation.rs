use crate::{
    inference::{Config, Device},
    intel_gpu,
};
use anyhow::{Result, ensure};
use ort::{environment::Environment, value::TensorRef};
use std::{path::Path, time::Instant};

// StemSplit six-stem export: drums, bass, other, vocals, guitar, piano.
const SEGMENT: usize = 343_980;
const OVERLAP: usize = SEGMENT / 4;
const STRIDE: usize = SEGMENT - OVERLAP;


pub fn stems(
    environment: &Environment,
    model: &Path,
    stereo: &[f32],
    config: &Config,
) -> Result<Vec<Vec<f32>>> {
    ensure!(
        stereo.len().is_multiple_of(2) && !stereo.is_empty(),
        "Expected nonempty stereo PCM"
    );
    let initialization = Instant::now();
    let mut intel = if config.device == Device::Openvino {
        Some(intel_gpu::Demucs::new(model, config, SEGMENT)?)
    } else {
        None
    };
    let mut session = if intel.is_none() {
        Some(
            config
                .builder(environment, "demucs")?
                .commit_from_file(model)?,
        )
    } else {
        None
    };
    println!(
        "  Demucs session: {:?}, load {:.2}s",
        config.device,
        initialization.elapsed().as_secs_f64()
    );
    let frames = stereo.len() / 2;
    let starts = chunk_starts(frames);
    let mut result = vec![vec![0.0; stereo.len()]; 6];
    let mut weight = vec![0.0; frames];
    let mut chunk = vec![0.0_f32; 2 * SEGMENT];
    for (index, &start) in starts.iter().enumerate() {
        let started = Instant::now();
        let length = (frames - start).min(SEGMENT);
        chunk.fill(0.0);
        for i in 0..length {
            chunk[i] = stereo[(start + i) * 2];
            chunk[SEGMENT + i] = stereo[(start + i) * 2 + 1];
        }
        let data = if let Some(intel) = &mut intel {
            intel.infer(&chunk, SEGMENT)?
        } else {
            let input = TensorRef::from_array_view(([1, 2, SEGMENT], chunk.as_slice()))?;
            let outputs = session
                .as_mut()
                .expect("ORT session exists")
                .run(ort::inputs!["mix" => input])?;
            let output = outputs
                .get("stems")
                .ok_or_else(|| anyhow::anyhow!("Model has no 'stems' output"))?;
            let (shape, data) = output.try_extract_tensor::<f32>()?;
            ensure!(
                shape.as_ref() == [1, 6, 2, SEGMENT as i64],
                "Unexpected six-stem ONNX output shape {shape:?}"
            );
            data.to_vec()
        };
        ensure!(
            data.len() == 12 * SEGMENT && data.iter().all(|v| v.is_finite()),
            "Demucs produced invalid samples"
        );
        accumulate(&data, &mut result, &mut weight, start, length);
        crate::progress("Instrumente trennen …", 10 + ((index + 1) * 40 / starts.len()) as u32);
        println!(
            "  Demucs chunk {}/{}: {:.2}s",
            index + 1,
            starts.len(),
            started.elapsed().as_secs_f64()
        );
    }
    for (frame, &w) in weight.iter().enumerate() {
        ensure!(w > 0.0, "Uncovered sample in Demucs overlap-add");
        for samples in &mut result {
            samples[frame * 2] /= w;
            samples[frame * 2 + 1] /= w;
        }
    }
    if let Some(session) = &mut session {
        config.finish_profile(session)?;
    }
    Ok(result)
}

fn accumulate(data: &[f32], result: &mut [Vec<f32>], weight: &mut [f32], start: usize, length: usize) {
    for i in 0..length {
        let w = window(i);
        weight[start + i] += w;
        for (stem, samples) in result.iter_mut().enumerate() {
            for channel in 0..2 {
                samples[(start + i) * 2 + channel] += data[(stem * 2 + channel) * SEGMENT + i] * w;
            }
        }
    }
}

fn chunk_starts(frames: usize) -> Vec<usize> {
    if frames == 0 {
        return Vec::new();
    }
    let mut starts = vec![0];
    while starts.last().copied().unwrap() + SEGMENT < frames {
        starts.push(starts.last().copied().unwrap() + STRIDE);
    }
    starts
}

fn window(index: usize) -> f32 {
    // Positive endpoints avoid losing the first/last sample through division by zero.
    ((index + 1).min(SEGMENT - index).min(OVERLAP + 1) as f32) / (OVERLAP + 1) as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn six_stems_keep_channels_separate_in_final_partial_chunk() {
        let mut data=vec![0.;12*SEGMENT];
        for channel in 0..12 { data[channel*SEGMENT..(channel+1)*SEGMENT].fill((channel+1) as f32); }
        let mut output=vec![vec![0.; 8];6]; let mut weights=vec![0.;4];
        accumulate(&data,&mut output,&mut weights,1,3);
        for stem in 0..6 { for frame in 1..4 { for channel in 0..2 {
            assert!((output[stem][frame*2+channel]/weights[frame] - (stem*2+channel+1) as f32).abs()<1e-5);
        } } }
        assert_eq!(weights[0],0.);
    }
    #[test]
    fn overlap_add_preserves_constant_signal_at_boundaries() {
        let frames = SEGMENT * 2 + 13;
        let mut accumulated = vec![0.0_f32; frames];
        let mut weights = vec![0.0_f32; frames];
        for start in chunk_starts(frames) {
            for i in 0..(frames - start).min(SEGMENT) {
                accumulated[start + i] += 0.42 * window(i);
                weights[start + i] += window(i);
            }
        }
        for (value, weight) in accumulated.into_iter().zip(weights) {
            assert!(weight > 0.0);
            assert!((value / weight - 0.42).abs() < 1e-6);
        }
        assert_eq!(chunk_starts(SEGMENT), vec![0]);
        assert_eq!(chunk_starts(SEGMENT + 1), vec![0, STRIDE]);
    }
}
