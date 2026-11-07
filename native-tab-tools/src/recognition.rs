use anyhow::{Context, Result, ensure};
use image::{DynamicImage, GrayImage, imageops::FilterType};
use ort::{environment::Environment, session::Session, value::TensorRef};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

pub fn environment(runtime: &Path) -> Result<Environment> {
    Ok(ort::init_from(runtime.join("runtime").join(crate::platform_paths::library("onnxruntime")))?
        .with_name("loopstudio-tab-tools")
        .with_telemetry(false)
        .build()?)
}
fn session(environment: &Environment, path: &Path) -> Result<Session> {
    Session::builder(environment)?
        .with_intra_threads(4)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .commit_from_file(path)
        .with_context(|| format!("Modell konnte nicht geladen werden: {}", path.display()))
}
pub struct Ocr {
    session: Session,
    characters: Vec<String>,
}
impl Ocr {
    pub fn new(environment: &Environment, runtime: &Path) -> Result<Self> {
        let session = session(environment, &runtime.join("models/ocr/recognizer.onnx"))?;
        let characters = session
            .metadata()?
            .custom("character")
            .context("OCR-Zeichentabelle fehlt")?;
        let mut characters: Vec<_> = characters.lines().map(str::to_owned).collect();
        characters.insert(0, "".into());
        characters.push(" ".into());
        Ok(Self {
            session,
            characters,
        })
    }
    pub fn read(&mut self, image: &GrayImage) -> Result<(String, f32)> {
        let width = (48. * image.width() as f64 / image.height().max(1) as f64).ceil() as u32;
        let width = width.clamp(1, 2048);
        let padded = width.max(320);
        let resized = image::imageops::resize(image, width, 48, FilterType::Triangle);
        let mut values = vec![0.; 3 * 48 * padded as usize];
        for c in 0..3 {
            for y in 0..48 {
                for x in 0..width {
                    values[(c * 48 + y as usize) * padded as usize + x as usize] =
                        resized.get_pixel(x, y)[0] as f32 / 127.5 - 1.;
                }
            }
        }
        let tensor = TensorRef::from_array_view(([1, 3, 48, padded as usize], values.as_slice()))?;
        let output = self.session.run(ort::inputs![tensor])?;
        let (shape, data) = output[0].try_extract_tensor::<f32>()?;
        ensure!(
            shape.len() == 3 && shape[0] == 1 && shape[2] as usize == self.characters.len(),
            "Ungültige OCR-Modellausgabe."
        );
        let mut result = String::new();
        let mut confidence = 0.;
        let mut count = 0;
        let mut previous = usize::MAX;
        for frame in data.chunks_exact(self.characters.len()) {
            let (index, &prob) = frame
                .iter()
                .enumerate()
                .max_by(|a, b| a.1.total_cmp(b.1))
                .context("Leere OCR-Ausgabe")?;
            if index != 0 && index != previous {
                result.push_str(&self.characters[index]);
                confidence += prob;
                count += 1;
            }
            previous = index;
        }
        Ok((
            result,
            if count > 0 {
                confidence / count as f32
            } else {
                0.
            },
        ))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format_version: u8,
    width: usize,
    height: usize,
    max_length: usize,
    vocab: BTreeMap<String, usize>,
    encoder_sha256: String,
    decoder_sha256: String,
}
pub struct Omr {
    encoder: Session,
    decoder: Session,
    manifest: Manifest,
    tokens: Vec<String>,
}
impl Omr {
    pub fn new(environment: &Environment, runtime: &Path) -> Result<Self> {
        let root = runtime.join("models/omr");
        let manifest: Manifest = serde_json::from_slice(
            &fs::read(root.join("manifest.json"))
                .context("OMR-ONNX-Modell fehlt. setup-tab-tools.ps1 ausführen.")?,
        )?;
        ensure!(
            manifest.format_version == 1
                && manifest.width == 1200
                && manifest.height == 224
                && (2..=384).contains(&manifest.max_length),
            "Nicht unterstütztes OMR-Modellformat."
        );
        ensure!(
            (4..=2048).contains(&manifest.vocab.len()),
            "Ungültiges OMR-Vokabular."
        );
        let mut tokens = vec![String::new(); manifest.vocab.len()];
        for (name, &id) in &manifest.vocab {
            ensure!(
                id < tokens.len() && tokens[id].is_empty(),
                "Ungültige OMR-Symbolnummer."
            );
            tokens[id] = name.clone();
        }
        for token in ["<BOS>", "<EOS>", "BAR", "BEAT"] {
            ensure!(
                manifest.vocab.contains_key(token),
                "OMR-Vokabular unvollständig."
            );
        }
        for (name, hash) in [
            ("encoder.onnx", &manifest.encoder_sha256),
            ("decoder.onnx", &manifest.decoder_sha256),
        ] {
            ensure!(
                format!("{:x}", Sha256::digest(fs::read(root.join(name))?)) == *hash,
                "OMR-Modellprüfsumme stimmt nicht: {name}"
            );
        }
        Ok(Self {
            encoder: session(environment, &root.join("encoder.onnx"))?,
            decoder: session(environment, &root.join("decoder.onnx"))?,
            manifest,
            tokens,
        })
    }
    pub fn recognize(
        &mut self,
        image: &DynamicImage,
        mut progress: impl FnMut(u32),
    ) -> Result<(Vec<String>, bool)> {
        let (mw, mh) = (self.manifest.width, self.manifest.height);
        let gray = image.to_luma8();
        let ratio = (mw as f64 / gray.width() as f64).min(mh as f64 / gray.height() as f64);
        let (w, h) = (
            (gray.width() as f64 * ratio).round().max(1.) as u32,
            (gray.height() as f64 * ratio).round().max(1.) as u32,
        );
        let resized = image::imageops::resize(&gray, w, h, FilterType::Lanczos3);
        let mut pixels = vec![0.; mw * mh];
        for y in 0..h {
            for x in 0..w {
                pixels[y as usize * mw + x as usize] =
                    1. - resized.get_pixel(x, y)[0] as f32 / 255.;
            }
        }
        let output = self.encoder.run(
            ort::inputs!["image"=>TensorRef::from_array_view(([1,1,mh,mw],pixels.as_slice()))?],
        )?;
        let (shape, data) = output["memory"].try_extract_tensor::<f32>()?;
        let shape: Vec<usize> = shape.iter().map(|&n| n as usize).collect();
        let memory = data.to_vec();
        drop(output);
        let eos = self.manifest.vocab["<EOS>"];
        let mut ids = vec![self.manifest.vocab["<BOS>"] as i64];
        let mut emitted = Vec::new();
        let mut ended = false;
        for step in 1..self.manifest.max_length {
            let output=self.decoder.run(ort::inputs!["tokens"=>TensorRef::from_array_view(([1,ids.len()],ids.as_slice()))?,"memory"=>TensorRef::from_array_view((shape.clone(),memory.as_slice()))?])?;
            let (shape, logits) = output["logits"].try_extract_tensor::<f32>()?;
            ensure!(
                shape.as_ref() == [1, self.tokens.len() as i64]
                    && logits.iter().all(|n| n.is_finite()),
                "Ungültige OMR-Ausgabe."
            );
            let state = DecodeState::from_tokens(&emitted);
            let next = (0..logits.len())
                .filter(|&i| state.allowed(&self.tokens[i]))
                .max_by(|&a, &b| {
                    (logits[a] - state.penalty(&self.tokens[a]))
                        .total_cmp(&(logits[b] - state.penalty(&self.tokens[b])))
                        .then_with(|| b.cmp(&a))
                })
                .context("Keine gültige OMR-Fortsetzung.")?;
            ids.push(next as i64);
            if next == eos {
                ended = true;
                break;
            }
            emitted.push(self.tokens[next].clone());
            if step % 8 == 0 {
                progress(35 + (step * 50 / self.manifest.max_length) as u32);
            }
        }
        Ok((emitted, ended))
    }
}

#[derive(Default)]
struct DecodeState {
    last: String,
    inside: bool,
    rest: bool,
    strings: BTreeSet<u8>,
    total: f64,
    committed: f64,
    value: Option<f64>,
    dots: u8,
    tuplet: f64,
    explicit: bool,
}
fn pair(s: &str) -> Option<(f64, f64)> {
    let (a, b) = s.split_once('_')?;
    Some((a.parse().ok()?, b.parse().ok()?))
}
fn metadata(t: &str) -> bool {
    ["CAPO_", "TEMPO_", "TUNING_"]
        .iter()
        .any(|p| t.starts_with(p))
}
fn prefix(t: &str) -> bool {
    t == "REPEAT_START"
        || t == "ANACRUSIS"
        || t.starts_with("ALT_ENDING_")
        || t.starts_with("SIMILE_")
}
fn suffix(t: &str) -> bool {
    t == "DOUBLE_BAR" || t == "FINAL_BAR" || t.starts_with("REPEAT_END_")
}
impl DecodeState {
    fn units(&self) -> f64 {
        self.value.map_or(0., |v| {
            4. / v * (2. - 2f64.powi(-(self.dots as i32))) * self.tuplet
        })
    }
    fn reset(&mut self) {
        self.rest = false;
        self.strings.clear();
        self.value = None;
        self.dots = 0;
        self.tuplet = 1.;
    }
    fn from_tokens(tokens: &[String]) -> Self {
        let mut s = Self {
            total: 4.,
            tuplet: 1.,
            ..Self::default()
        };
        for t in tokens {
            if t == "BAR" {
                s.inside = true;
                s.committed = 0.;
                s.reset();
            } else if t == "END_BAR" {
                s.committed += s.units();
                s.inside = false;
                s.reset();
            } else if t == "BEAT" {
                s.committed += s.units();
                s.reset();
            } else if let Some(v) = t.strip_prefix("TS_").and_then(pair) {
                s.total = v.0 * 4. / v.1;
                s.explicit = true;
            } else if let Some(v) = t.strip_prefix("DUR_") {
                s.value = v.parse().ok();
            } else if let Some(v) = t.strip_prefix("DOTS_") {
                s.dots = v.parse().unwrap_or(0);
            } else if let Some(v) = t.strip_prefix("TUPLET_").and_then(pair) {
                s.tuplet = v.1 / v.0;
            } else if t == "REST" {
                s.rest = true;
            } else if let Some(v) = t
                .strip_prefix("N_S")
                .and_then(|v| v.split_once("_F"))
                .and_then(|(v, _)| v.parse().ok())
            {
                s.strings.insert(v);
            }
            s.last = t.clone();
        }
        s
    }
    fn allowed(&self, t: &str) -> bool {
        let time = t.starts_with("TS_");
        let bar = t == "BAR";
        let end = t == "END_BAR";
        let beat = t == "BEAT";
        let note = t
            .strip_prefix("N_S")
            .and_then(|v| v.split_once("_F"))
            .and_then(|(v, _)| v.parse::<u8>().ok())
            .is_some_and(|n| !self.rest && self.strings.len() < 6 && !self.strings.contains(&n));
        let rest = t == "REST" && self.strings.is_empty();
        let dynamic = t.starts_with("DYN_");
        let btech = t.starts_with("BTECH_");
        let ntech = t.starts_with("NTECH_") || t.starts_with("TECH_");
        let last = self.last.as_str();
        if last.is_empty() {
            return metadata(t) || time || bar;
        }
        if last == "END_BAR" {
            return metadata(t) || time || bar || t == "<EOS>";
        }
        if !self.inside {
            if metadata(last) {
                return metadata(t) || time || bar;
            }
            if last.starts_with("TS_") {
                return bar;
            }
        }
        if last == "BAR" || prefix(last) {
            return prefix(t) || time || beat || suffix(t) || end;
        }
        if last == "DOUBLE_BAR" || last.starts_with("REPEAT_END_") {
            return suffix(t) || end;
        }
        if last.starts_with("TS_") {
            return beat || end;
        }
        if last == "BEAT" {
            return t.starts_with("DUR_");
        }
        if last.starts_with("DUR_") {
            return t.starts_with("DOTS_")
                || t.starts_with("TUPLET_")
                || dynamic
                || btech
                || rest
                || note;
        }
        if last.starts_with("DOTS_") {
            return t.starts_with("TUPLET_") || dynamic || btech || rest || note;
        }
        if last.starts_with("TUPLET_") {
            return dynamic || btech || rest || note;
        }
        if last.starts_with("DYN_") || last.starts_with("BTECH_") {
            return btech || rest || note;
        }
        if last == "REST" {
            return beat || suffix(t) || end;
        }
        if last.starts_with("N_S") || last.starts_with("NTECH_") || last.starts_with("TECH_") {
            return note || ntech || beat || suffix(t) || end;
        }
        metadata(t)
            || time
            || bar
            || end
            || beat
            || prefix(t)
            || suffix(t)
            || note
            || rest
            || dynamic
            || btech
            || ntech
            || t.starts_with("DUR_")
            || t.starts_with("DOTS_")
            || t.starts_with("TUPLET_")
            || t == "<EOS>"
    }
    fn penalty(&self, t: &str) -> f32 {
        if !self.inside || !self.explicit {
            return 0.;
        }
        if self.last == "BEAT"
            && t.strip_prefix("DUR_")
                .and_then(|v| v.parse::<f64>().ok())
                .is_some_and(|v| self.committed + 4. / v > self.total + 1e-8)
            || t == "BEAT" && self.committed + self.units() >= self.total - 1e-8
        {
            2.5
        } else {
            0.
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn grammar_excludes_repeated_strings_and_eos_inside_bar() {
        let tokens = "TS_4_4 BAR BEAT DUR_4 N_S1_F3"
            .split_whitespace()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let s = DecodeState::from_tokens(&tokens);
        assert!(!s.allowed("N_S1_F5"));
        assert!(s.allowed("N_S2_F5"));
        assert!(!s.allowed("<EOS>"));
        assert!(s.allowed("END_BAR"));
    }
    #[test]
    fn beat_units_include_dots_and_tuplets() {
        let tokens = "TS_4_4 BAR BEAT DUR_2 DOTS_1 TUPLET_3_2 N_S1_F3 BEAT DUR_2 N_S2_F0"
            .split_whitespace()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let s = DecodeState::from_tokens(&tokens);
        assert!((s.committed - 2.).abs() < 1e-8);
        assert_eq!(s.penalty("BEAT"), 2.5);
    }
}
