use crate::score::{Bar, Beat, Note, Score};
use anyhow::{Result, ensure};

fn row(line: &str) -> Option<Vec<char>> {
    let line = line.trim();
    let border = line.find('|')?;
    let label = line[..border].trim();
    if label.len() > 2 || !label.chars().all(|c| "eEBbGgDdAa#".contains(c)) {
        return None;
    }
    let body = &line[border..];
    if !body.contains('-') || !body.chars().all(|c| c.is_ascii() && !c.is_control()) {
        return None;
    }
    Some(body.chars().collect())
}
pub fn parse(text: &str, title: &str, bpm: u16, meter: Option<(u8, u8)>) -> Result<Option<Score>> {
    let mut score = Score::new(title, bpm)?;
    let (n, d) = meter.unwrap_or((4, 4));
    crate::score::validate_meter(n, d)?;
    let lines: Vec<_> = text.lines().collect();
    let mut i = 0;
    while i + 6 <= lines.len() {
        let rows: Option<Vec<_>> = lines[i..i + 6].iter().map(|line| row(line)).collect();
        let Some(rows) = rows else {
            i += 1;
            continue;
        };
        i += 6;
        let borders: Vec<_> = rows[0]
            .iter()
            .enumerate()
            .filter(|(_, c)| **c == '|')
            .map(|(x, _)| x)
            .collect();
        if borders.len() < 2 {
            continue;
        }
        ensure!(
            rows.iter()
                .all(|r| borders.iter().all(|&x| r.get(x) == Some(&'|'))),
            "Die sechs Text-Tab-Zeilen haben unterschiedliche Taktgrenzen."
        );
        for range in borders.windows(2) {
            if range[1] - range[0] < 2 {
                continue;
            }
            let mut events: std::collections::BTreeMap<usize, Vec<Note>> =
                std::collections::BTreeMap::new();
            for (string, r) in rows.iter().enumerate() {
                let mut x = range[0] + 1;
                while x < range[1] {
                    let c = r[x];
                    if c.is_ascii_digit() {
                        let start = x;
                        let mut fret = String::new();
                        while x < range[1] && r[x].is_ascii_digit() {
                            fret.push(r[x]);
                            x += 1;
                        }
                        let fret: u8 = fret.parse()?;
                        ensure!(fret <= 36, "Ungültige Bundzahl im Text-PDF.");
                        events.entry(start).or_default().push(Note {
                            string: string as u8 + 1,
                            fret,
                            dead: false,
                        });
                    } else {
                        if c == 'x' || c == 'X' {
                            events.entry(x).or_default().push(Note {
                                string: string as u8 + 1,
                                fret: 0,
                                dead: true,
                            });
                        }
                        x += 1;
                    }
                }
            }
            if events.is_empty() {
                continue;
            }
            let (value, tuplet) = crate::raster::inferred_duration(events.len(), n, d);
            score.bars.push(Bar {
                numerator: n,
                denominator: d,
                beats: events
                    .into_values()
                    .map(|notes| Beat {
                        value,
                        dotted: false,
                        tuplet,
                        notes,
                    })
                    .collect(),
            });
            ensure!(
                score.bars.len() <= 500 && score.note_count() <= 10000,
                "Zu viele Takte oder Noten."
            );
        }
    }
    if score.bars.is_empty() {
        return Ok(None);
    }
    score.warnings.push("Text-Tabulatur: Rhythmus gleichmäßig pro Takt geschätzt; Spieltechniken, Wiederholungen und nicht ausgeschriebene Pausen bitte anhand der Vorlage ergänzen.".into());
    score.validate()?;
    Ok(Some(score))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_chords_two_digit_frets_and_dead_notes() {
        let text = "Title\ne|--0--12--|\nB|--2------|\nG|---------|\nD|---------|\nA|-----10--|\nE|--x------|";
        let score = parse(text, "Test", 100, None).unwrap().unwrap();
        assert_eq!(score.note_count(), 5);
        assert_eq!(score.bars[0].beats.len(), 2);
        assert_eq!(score.bars[0].beats[1].notes[0].fret, 12);
        assert_eq!(score.bars[0].beats[1].notes[1].fret, 10);
        assert!(score.bars[0].beats[0].notes[2].dead);
    }
    #[test]
    fn rejects_misaligned_bars() {
        let text = "e|--0--|\nB|-----|\nG|-----|\nD|----|\nA|-----|\nE|-----|";
        assert!(parse(text, "Test", 100, None).is_err());
    }
}
