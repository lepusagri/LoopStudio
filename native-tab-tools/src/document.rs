use anyhow::{Context, Result, ensure};
use image::{DynamicImage, ImageReader, Rgb, RgbImage};
use pdfium_render::prelude::*;
use std::path::{Path, PathBuf};

pub const MAX_PIXELS: u64 = 20_000_000;
pub fn load_image(path: &Path) -> Result<DynamicImage> {
    let mut reader = ImageReader::open(path)?.with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(MAX_PIXELS * 8);
    reader.limits(limits);
    let (w, h) = ImageReader::open(path)?
        .with_guessed_format()?
        .into_dimensions()?;
    ensure!(
        w > 0 && h > 0 && u64::from(w) * u64::from(h) <= MAX_PIXELS,
        "Das Bild überschreitet 20 Megapixel."
    );
    let image = reader.decode()?;
    // Composite transparency onto white rather than interpreting it as black.
    let rgba = image.to_rgba8();
    Ok(DynamicImage::ImageRgb8(RgbImage::from_fn(w, h, |x, y| {
        let p = rgba.get_pixel(x, y);
        let a = p[3] as u32;
        Rgb(std::array::from_fn(|c| {
            ((p[c] as u32 * a + 255 * (255 - a)) / 255) as u8
        }))
    })))
}
pub fn pdfium(runtime: &Path) -> Result<Pdfium> {
    Ok(Pdfium::new(
        Pdfium::bind_to_library(runtime.join("runtime").join(crate::platform_paths::library("pdfium")))
            .context("PDFium fehlt. setup-tab-tools.ps1 ausführen.")?,
    ))
}
pub fn compose(runtime: &Path, paths: &[PathBuf], output: &Path) -> Result<()> {
    ensure!(
        (1..=8).contains(&paths.len()),
        "Bitte 1 bis 8 Bildausschnitte wählen."
    );
    let mut images = Vec::new();
    let (mut width, mut height) = (0u32, 60u32);
    for path in paths {
        let image = load_image(path)?.to_rgb8();
        width = width.max(image.width().checked_add(80).context("Bild zu breit")?);
        height = height
            .checked_add(image.height() + 60)
            .context("Bild zu hoch")?;
        images.push(image);
    }
    ensure!(
        u64::from(width) * u64::from(height) <= MAX_PIXELS,
        "Die zusammengesetzte PDF-Seite ist zu groß (maximal 20 Megapixel)."
    );
    let mut page_image = RgbImage::from_pixel(width, height, Rgb([255; 3]));
    let mut y = 60;
    for image in images {
        image::imageops::replace(&mut page_image, &image, 40, y as i64);
        y += image.height() + 60;
    }
    let pdfium = pdfium(runtime)?;
    let mut document = pdfium.create_new_pdf()?;
    let (w, h) = (
        PdfPoints::new(width as f32 * 72. / 150.),
        PdfPoints::new(height as f32 * 72. / 150.),
    );
    let image =
        PdfPageImageObject::new_with_size(&document, &DynamicImage::ImageRgb8(page_image), w, h)?;
    {
        let mut page = document
            .pages_mut()
            .create_page_at_end(PdfPagePaperSize::new_custom(w, h))?;
        page.objects_mut().add_image_object(image)?;
    }
    document.save_to_file(output)?;
    Ok(())
}
pub fn pages(runtime: &Path, path: &Path) -> Result<Vec<DynamicImage>> {
    if !std::fs::read(path)?.starts_with(b"%PDF-") {
        return Ok(vec![load_image(path)?]);
    }
    let pdfium = pdfium(runtime)?;
    let document = pdfium.load_pdf_from_file(path, None)?;
    ensure!(
        !document.pages().is_empty() && document.pages().len() <= 15,
        "Maximal 15 PDF-Seiten."
    );
    // Process images one page at a time in callers when this limit changes.
    ensure!(
        document.pages().len() <= 8,
        "Maximal 8 PDF-Bildseiten pro Auftrag."
    );
    let mut images = Vec::new();
    for page in document.pages().iter() {
        let ratio = page.height().value / page.width().value;
        ensure!(
            ratio.is_finite() && ratio > 0. && ratio < 100.,
            "Ungültige PDF-Seitengröße."
        );
        let width = 1800_i32
            .min((MAX_PIXELS as f64 / ratio as f64).sqrt() as i32)
            .max(1);
        let bitmap = page.render_with_config(
            &PdfRenderConfig::new()
                .set_target_width(width)
                .set_maximum_height(6000),
        )?;
        let image = bitmap.as_image();
        ensure!(
            image.width() as u64 * image.height() as u64 <= MAX_PIXELS,
            "PDF-Seite zu groß."
        );
        images.push(image);
    }
    Ok(images)
}

pub fn ascii_pdf(
    runtime: &Path,
    path: &Path,
    title: &str,
    bpm: u16,
    meter: Option<(u8, u8)>,
) -> Result<Option<crate::score::Score>> {
    let pdfium = pdfium(runtime)?;
    let document = pdfium.load_pdf_from_file(path, None)?;
    ensure!(
        !document.pages().is_empty() && document.pages().len() <= 15,
        "Maximal 15 PDF-Seiten."
    );
    let mut score = None;
    for page in document.pages().iter() {
        let text = page.text()?.all();
        let Some(mut part) = crate::ascii::parse(&text, title, bpm, meter)? else {
            return Ok(None);
        };
        if let Some(score) = score.as_mut() {
            let score: &mut crate::score::Score = score;
            score.bars.append(&mut part.bars);
        } else {
            score = Some(part);
        }
    }
    if let Some(score) = &score {
        score.validate()?;
    }
    Ok(score)
}
