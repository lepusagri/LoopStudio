use anyhow::{Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use clap::{Parser, Subcommand};
use loopstudio_tab_tools::{document, gp5, recognition, score};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Write},
    path::PathBuf,
};

#[derive(Parser)]
#[command(about = "Native local PDF/OCR and Guitar Tab OMR; no Python runtime")]
struct Args {
    #[command(subcommand)]
    command: Option<Action>,
    #[arg(long)]
    engine: Option<String>,
    #[arg(long)]
    source: Option<PathBuf>,
    #[arg(long)]
    runtime: PathBuf,
    #[arg(long)]
    output: PathBuf,
    #[arg(long, default_value_t = 120)]
    bpm: u16,
    #[arg(long)]
    numerator: Option<u8>,
    #[arg(long)]
    denominator: Option<u8>,
}
#[derive(Subcommand)]
enum Action {
    Compose {
        #[arg(required = true)]
        images: Vec<PathBuf>,
    },
    Tokens {
        source: PathBuf,
    },
}
fn progress(message: &str, percent: u32) {
    println!("{}", json!({"message":message,"percent":percent}));
    let _ = io::stdout().flush();
}
fn run(args: Args) -> Result<()> {
    if let Some(Action::Compose { images }) = args.command {
        return document::compose(&args.runtime, &images, &args.output);
    }
    if let Some(Action::Tokens { source }) = args.command {
        let tokens = fs::read_to_string(source)?
            .split_whitespace()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let s = score::tokens_to_score(&tokens, args.bpm, "OMR-Test")?;
        fs::write(args.output, gp5::write(&s)?)?;
        return Ok(());
    }
    let engine = args.engine.as_deref().unwrap_or("");
    ensure!(
        ["pdf", "omr"].contains(&engine),
        "Unbekanntes Tab-Werkzeug."
    );
    ensure!((20..=400).contains(&args.bpm), "Ungültiges Tempo.");
    ensure!(
        args.numerator.is_some() == args.denominator.is_some(),
        "Unvollständige Taktart."
    );
    let meter = args.numerator.zip(args.denominator);
    if let Some((n, d)) = meter {
        score::validate_meter(n, d)?;
    }
    let source = args
        .source
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Eingabe fehlt."))?;
    let meta = source.metadata()?;
    ensure!(
        meta.is_file() && meta.len() <= 40 * 1024 * 1024,
        "Datei fehlt oder ist größer als 40 MB."
    );
    fs::create_dir_all(&args.output)?;
    let bytes = fs::read(source)?;
    let title = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Tabulatur");
    progress("Native Tab-Werkzeuge werden geladen …", 5);
    let environment = recognition::environment(&args.runtime)?;
    let mut tokens = String::new();
    let (score, mut report) = if engine == "omr" {
        ensure!(
            !bytes.starts_with(b"%PDF-"),
            "Guitar Tab OMR benötigt eine ausgeschnittene Bilddatei, kein PDF."
        );
        let image = document::load_image(source)?;
        progress("Guitar Tab OMR: ONNX-Modell laden …", 15);
        let mut model = recognition::Omr::new(&environment, &args.runtime)?;
        progress("Guitar Tab OMR: Tabulatur lesen …", 35);
        let (recognized, ended) =
            model.recognize(&image, |p| progress("Guitar Tab OMR: Tabulatur lesen …", p))?;
        tokens = recognized.join(" ");
        fs::write(args.output.join("tokens.txt"), &tokens)?;
        let mut score = score::tokens_to_score(&recognized, args.bpm, title)?;
        if !ended {
            score.warnings.push(
                "Die Ausgabe hat die maximale Länge erreicht und kann unvollständig sein.".into(),
            );
        }
        let mut report = score.report();
        report["model"] = json!("kk9293/guitar-tab-omr");
        report["device"] = json!("cpu");
        report["sawEos"] = json!(ended);
        report["tokenCount"] = json!(recognized.len());
        (score, report)
    } else if let Some(score) = if bytes.starts_with(b"%PDF-") {
        document::ascii_pdf(&args.runtime, source, title, args.bpm, meter)?
    } else {
        None
    } {
        let report = score.report();
        (score, report)
    } else {
        progress("PDF / Bild wird nativ gelesen …", 15);
        let images = document::pages(&args.runtime, source)?;
        let mut ocr = recognition::Ocr::new(&environment, &args.runtime)?;
        let score = loopstudio_tab_tools::raster::recognize(
            &images,
            &mut ocr,
            title,
            args.bpm,
            meter,
            |p| progress("Tabulaturzahlen werden gelesen …", p),
        )?;
        let report = score.report();
        (score, report)
    };
    progress("Erkannte Noten werden geprüft …", 90);
    let gp5 = gp5::write(&score)?;
    report["inputSha256"] = json!(format!("{:x}", Sha256::digest(bytes)));
    report["tempoInput"] = json!(args.bpm);
    report["engineRevision"] = json!("rust-0.8.0");
    report["backend"] = json!("native-rust");
    fs::write(args.output.join("result.gp5"), &gp5)?;
    fs::write(
        args.output.join("result.json"),
        serde_json::to_vec(
            &json!({"engine":engine,"filename":format!("{title}.gp5"),"gp5":STANDARD.encode(gp5),"report":report,"tokens":tokens}),
        )?,
    )?;
    progress("Ergebnis bereit. Bitte die Vorschau prüfen.", 100);
    Ok(())
}
fn main() {
    if let Err(error) = run(Args::parse()) {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}
