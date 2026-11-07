//! Native staff/number extraction. Geometry is kept separate from OCR so that
//! uncertain rhythm and unrecognised symbols can be reported explicitly.
use crate::{
    recognition::Ocr,
    score::{Bar, Beat, Note, Score},
};
use anyhow::{Result, ensure};
use image::{DynamicImage, GrayImage, Luma};

#[derive(Clone, Debug)]
struct Line {
    y: u32,
    top: u32,
    bottom: u32,
    left: u32,
    right: u32,
}
fn lines(image: &GrayImage) -> Vec<Line> {
    let (w, h) = image.dimensions();
    let minimum = (w / 300).max(5);
    let mut result: Vec<Line> = vec![];
    for y in 0..h {
        let mut start = 0;
        let mut coverage = 0;
        let mut left = w;
        let mut right = 0;
        for x in 0..=w {
            if x < w && image.get_pixel(x, y)[0] < 200 {
                if x == 0 || image.get_pixel(x - 1, y)[0] >= 200 {
                    start = x;
                }
            } else if x > start && x - start >= minimum {
                coverage += x - start;
                left = left.min(start);
                right = right.max(x - 1);
                start = x + 1;
            } else {
                start = x + 1;
            }
        }
        if right <= left
            || coverage < (w / 10)
            || coverage as f64 / ((right - left + 1) as f64) < 0.55
        {
            continue;
        }
        if let Some(previous) = result.last_mut().filter(|l| y <= l.bottom + 1) {
            previous.bottom = y;
            previous.y = (previous.top + y) / 2;
            previous.left = previous.left.min(left);
            previous.right = previous.right.max(right);
        } else {
            result.push(Line {
                y,
                top: y,
                bottom: y,
                left,
                right,
            });
        }
    }
    result.retain(|l| l.bottom - l.top <= 4);
    result
}
fn systems(image: &GrayImage) -> Vec<[Line; 6]> {
    let candidates = lines(image);
    let mut result = vec![];
    let mut i = 0;
    while i + 5 < candidates.len() {
        let group = &candidates[i..i + 6];
        let spacing = (group[5].y - group[0].y) as f64 / 5.;
        if spacing >= 5.
            && (1..6)
                .all(|j| ((group[j].y - group[j - 1].y) as f64 - spacing).abs() <= spacing * 0.22)
        {
            result.push(std::array::from_fn(|j| group[j].clone()));
            i += 6;
        } else {
            i += 1;
        }
    }
    result
}
fn clusters(xs: &[u32], gap: u32) -> Vec<(u32, u32)> {
    let mut groups: Vec<(u32, u32)> = vec![];
    for &x in xs {
        if let Some(last) = groups.last_mut().filter(|last| x - last.1 <= gap) {
            last.1 = x;
        } else {
            groups.push((x, x));
        }
    }
    groups
}
pub(crate) fn inferred_duration(count: usize, n: u8, d: u8) -> (u8, Option<(u8, u8)>) {
    let ticks = n as f64 * 3840. / d as f64 / count.max(1) as f64;
    for v in [1, 2, 4, 8, 16, 32, 64] {
        if (3840. / v as f64 - ticks).abs() < 0.1 {
            return (v, None);
        }
    }
    for (a, b) in [(3, 2), (5, 4), (6, 4), (7, 4), (9, 8)] {
        for v in [1, 2, 4, 8, 16, 32, 64] {
            if (3840. / v as f64 * b as f64 / a as f64 - ticks).abs() < 0.1 {
                return (v, Some((a, b)));
            }
        }
    }
    (8, None)
}
pub fn recognize(
    images: &[DynamicImage],
    ocr: &mut Ocr,
    title: &str,
    bpm: u16,
    meter: Option<(u8, u8)>,
    mut progress: impl FnMut(u32),
) -> Result<Score> {
    let mut score = Score::new(title, bpm)?;
    let (n, d) = meter.unwrap_or((4, 4));
    crate::score::validate_meter(n, d)?;
    let mut rejected = 0;
    for (page, image) in images.iter().enumerate() {
        let gray = image.to_luma8();
        for staff in systems(&gray) {
            let spacing = (staff[5].y - staff[0].y) as f64 / 5.;
            let left = staff.iter().map(|l| l.left).max().unwrap();
            let right = staff.iter().map(|l| l.right).min().unwrap();
            let vertical: Vec<_> = (left..=right)
                .filter(|&x| {
                    let total = staff[5].y - staff[0].y + 1;
                    let dark = (staff[0].y..=staff[5].y)
                        .filter(|&y| gray.get_pixel(x, y)[0] < 180)
                        .count();
                    dark as f64 / total as f64 > 0.85
                })
                .collect();
            let mut bars: Vec<_> = clusters(&vertical, 3)
                .into_iter()
                .map(|(a, b)| (a + b) / 2)
                .collect();
            if bars.first().is_none_or(|&x| x > left + spacing as u32) {
                bars.insert(0, left);
            }
            if bars.last().is_none_or(|&x| x + (spacing as u32) < right) {
                bars.push(right);
            }
            let mut notes: Vec<(f64, Note)> = vec![];
            for (string, line) in staff.iter().enumerate() {
                let top = line.y.saturating_sub((spacing * 0.47) as u32);
                let bottom = (line.y + (spacing * 0.47) as u32).min(gray.height() - 1);
                let occupied: Vec<_> = (left + 2..right.saturating_sub(2))
                    .filter(|&x| {
                        !bars.iter().any(|&b| x.abs_diff(b) <= 2)
                            && (top..=bottom)
                                .filter(|&y| y + 1 < line.top || y > line.bottom + 1)
                                .filter(|&y| gray.get_pixel(x, y)[0] < 180)
                                .count()
                                >= 2
                    })
                    .collect();
                for (a, b) in clusters(&occupied, (spacing * 0.42).max(2.) as u32) {
                    if b - a > spacing as u32 * 3 || b - a < 1 {
                        continue;
                    }
                    let pad = (spacing * 0.28).max(3.) as u32;
                    let mut crop = GrayImage::from_pixel(
                        b - a + 1 + pad * 2,
                        bottom - top + 1 + pad * 2,
                        Luma([255]),
                    );
                    for y in top..=bottom {
                        for x in a..=b {
                            crop.put_pixel(x - a + pad, y - top + pad, *gray.get_pixel(x, y));
                        }
                    }
                    let (text, confidence) = ocr.read(&crop)?;
                    let text = text.trim();
                    let dead = text.eq_ignore_ascii_case("x");
                    let fret = if dead {
                        Some(0)
                    } else if text.len() <= 2 && text.chars().all(|c| c.is_ascii_digit()) {
                        text.parse::<u8>().ok().filter(|n| *n <= 36)
                    } else {
                        None
                    };
                    if let Some(fret) = fret.filter(|_| confidence >= 0.5) {
                        notes.push((
                            (a + b) as f64 / 2.,
                            Note {
                                string: string as u8 + 1,
                                fret,
                                dead,
                            },
                        ));
                    } else {
                        rejected += 1;
                    }
                }
            }
            for window in bars.windows(2) {
                if window[1] - window[0] < (spacing * 2.) as u32 {
                    continue;
                }
                let mut events: Vec<(f64, Vec<Note>)> = vec![];
                let mut selected: Vec<_> = notes
                    .iter()
                    .filter(|(x, _)| *x > window[0] as f64 && *x < window[1] as f64)
                    .cloned()
                    .collect();
                selected.sort_by(|a, b| a.0.total_cmp(&b.0));
                for (x, note) in selected {
                    if let Some((_, chord)) = events.last_mut().filter(|(old, ns)| {
                        (x - *old).abs() < spacing * 0.45
                            && !ns.iter().any(|n| n.string == note.string)
                    }) {
                        chord.push(note);
                    } else {
                        events.push((x, vec![note]));
                    }
                }
                if events.is_empty() {
                    continue;
                }
                let (value, tuplet) = inferred_duration(events.len(), n, d);
                score.bars.push(Bar {
                    numerator: n,
                    denominator: d,
                    beats: events
                        .into_iter()
                        .map(|(_, notes)| Beat {
                            value,
                            tuplet,
                            notes,
                            dotted: false,
                        })
                        .collect(),
                });
                ensure!(
                    score.bars.len() <= 500 && score.note_count() <= 10000,
                    "Zu viele Takte oder Noten."
                );
            }
        }
        progress(15 + ((page + 1) * 70 / images.len()) as u32);
    }
    score.warnings.push("Native OCR: Notenwerte wurden gleichmäßig innerhalb der erkannten Takte geschätzt. Pausen, gezeichnete Rhythmuszeichen, Spieltechniken und Wiederholungen müssen gegen die Vorlage geprüft und bei Bedarf im Editor ergänzt werden.".into());
    if rejected > 0 {
        score.warnings.push(format!("{rejected} Bildzeichen konnten nicht sicher als Bundzahl gelesen werden und wurden ausgelassen."));
    }
    score.validate().map_err(|_|anyhow::anyhow!("Keine ausreichend sichere Tabulatur erkannt. Bitte die vollständigen sechs Linien einschließlich Zahlen und etwas freien Randes ausschneiden."))?;
    Ok(score)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_two_systems_and_ignores_five_line_staff() {
        let mut image = GrayImage::from_pixel(600, 300, Luma([255]));
        for top in [20, 130] {
            for string in 0..6 {
                for x in 30..570 {
                    image.put_pixel(x, top + string * 12, Luma([0]));
                }
            }
        }
        for string in 0..5 {
            for x in 30..570 {
                image.put_pixel(x, 230 + string * 10, Luma([0]));
            }
        }
        assert_eq!(systems(&image).len(), 2);
    }
}
