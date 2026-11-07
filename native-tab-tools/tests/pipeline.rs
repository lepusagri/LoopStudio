use loopstudio_tab_tools::{document, raster, recognition};
use std::path::PathBuf;

#[test]
#[ignore = "Requires LOOPSTUDIO_TOOLS_RUNTIME with verified PDFium/OCR assets"]
fn native_image_pdf_and_composition_preserve_strings_and_two_digit_frets() {
    let runtime = PathBuf::from(std::env::var_os("LOOPSTUDIO_TOOLS_RUNTIME").expect("runtime"));
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let environment = recognition::environment(&runtime).unwrap();
    let mut ocr = recognition::Ocr::new(&environment, &runtime).unwrap();
    let expected = vec![
        vec![(1, 0), (2, 12)],
        vec![(3, 5), (6, 3)],
        vec![(4, 7), (5, 10)],
        vec![(1, 2), (2, 9)],
    ];
    for name in ["tab.png", "tab.pdf"] {
        let pages = document::pages(&runtime, &fixtures.join(name)).unwrap();
        let score = raster::recognize(&pages, &mut ocr, "Test", 120, Some((4, 4)), |_| {}).unwrap();
        let notes: Vec<Vec<_>> = score
            .bars
            .iter()
            .map(|bar| {
                bar.beats
                    .iter()
                    .flat_map(|b| b.notes.iter().map(|n| (n.string, n.fret)))
                    .collect()
            })
            .collect();
        assert_eq!(notes, expected, "{name}");
    }
    let output = tempfile::tempdir().unwrap();
    let composed = output.path().join("composed.pdf");
    // Use a cropped first staff so two clips fit the same 20 MP limit.
    let image = document::load_image(&fixtures.join("tab.png"))
        .unwrap()
        .crop_imm(110, 180, 1090, 140);
    let clip = output.path().join("clip.png");
    image.save(&clip).unwrap();
    document::compose(&runtime, &[clip.clone(), clip], &composed).unwrap();
    let pages = document::pages(&runtime, &composed).unwrap();
    let score =
        raster::recognize(&pages, &mut ocr, "Composition", 90, Some((3, 4)), |_| {}).unwrap();
    assert_eq!(score.bars.len(), 4);
    assert_eq!(score.note_count(), 8);
    assert!(
        score
            .bars
            .iter()
            .all(|bar| bar.numerator == 3 && bar.denominator == 4)
    );
}
