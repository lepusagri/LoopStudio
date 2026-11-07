use anyhow::{Result, bail, ensure};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Note {
    pub string: u8,
    pub fret: u8,
    pub dead: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Beat {
    pub value: u8,
    pub dotted: bool,
    pub tuplet: Option<(u8, u8)>,
    pub notes: Vec<Note>,
}
impl Default for Beat {
    fn default() -> Self {
        Self {
            value: 4,
            dotted: false,
            tuplet: None,
            notes: vec![],
        }
    }
}
impl Beat {
    pub fn ticks(&self) -> f64 {
        3840. / self.value as f64
            * if self.dotted { 1.5 } else { 1. }
            * self
                .tuplet
                .map_or(1., |(enters, times)| times as f64 / enters as f64)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Bar {
    pub numerator: u8,
    pub denominator: u8,
    pub beats: Vec<Beat>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Score {
    pub title: String,
    pub tempo: u16,
    pub capo: u8,
    pub bars: Vec<Bar>,
    pub warnings: Vec<String>,
}
impl Score {
    pub fn new(title: &str, tempo: u16) -> Result<Self> {
        ensure!(
            (20..=400).contains(&tempo),
            "Tempo muss zwischen 20 und 400 BPM liegen."
        );
        Ok(Self {
            title: title.into(),
            tempo,
            capo: 0,
            bars: vec![],
            warnings: vec![],
        })
    }
    pub fn note_count(&self) -> usize {
        self.bars
            .iter()
            .flat_map(|b| &b.beats)
            .map(|b| b.notes.len())
            .sum()
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(
            !self.bars.is_empty() && self.bars.len() <= 500,
            "Maximal 500 Takte pro Auftrag."
        );
        ensure!(
            (20..=400).contains(&self.tempo) && self.capo <= 24,
            "Ungültiges Tempo oder Kapodaster."
        );
        ensure!(
            (1..=10000).contains(&self.note_count()),
            "Keine spielbaren Noten oder mehr als 10.000 Noten erkannt."
        );
        let mut events = 0;
        for bar in &self.bars {
            validate_meter(bar.numerator, bar.denominator)?;
            events += bar.beats.len();
            ensure!(events <= 10000, "Maximal 10.000 Ereignisse pro Auftrag.");
            for beat in &bar.beats {
                ensure!(
                    [1, 2, 4, 8, 16, 32, 64].contains(&beat.value),
                    "Nicht unterstützter Notenwert."
                );
                if let Some((n, d)) = beat.tuplet {
                    ensure!(
                        matches!(
                            (n, d),
                            (3, 2)
                                | (5, 4)
                                | (6, 4)
                                | (7, 4)
                                | (9, 8)
                                | (10, 8)
                                | (11, 8)
                                | (12, 8)
                                | (13, 8)
                        ),
                        "Nicht unterstützte Tuplet-Aufteilung."
                    );
                }
                let mut used = BTreeSet::new();
                for note in &beat.notes {
                    ensure!(
                        (1..=6).contains(&note.string)
                            && note.fret <= 36
                            && used.insert(note.string),
                        "Ungültige oder doppelte Saitenposition im Ergebnis."
                    );
                }
            }
        }
        Ok(())
    }
    pub fn report(&self) -> serde_json::Value {
        let mut warnings = self.warnings.clone();
        let incomplete: Vec<_> = self
            .bars
            .iter()
            .enumerate()
            .filter(|(_, bar)| {
                (bar.beats.iter().map(Beat::ticks).sum::<f64>()
                    - bar.numerator as f64 * 3840. / bar.denominator as f64)
                    .abs()
                    > 0.5
            })
            .map(|(i, _)| (i + 1).to_string())
            .collect();
        if !incomplete.is_empty() {
            warnings.push(format!(
                "Abweichende Taktfüllung in Takten {}: Ergebnis gegen das Bild prüfen.",
                incomplete.join(", ")
            ));
        }
        serde_json::json!({"notes":self.note_count(),"bars":self.bars.len(),"measures":self.bars.len(),"warnings":warnings})
    }
}
pub fn validate_meter(n: u8, d: u8) -> Result<()> {
    ensure!(
        (1..=32).contains(&n) && [1, 2, 4, 8, 16, 32].contains(&d),
        "Ungültige Taktart."
    );
    Ok(())
}

// Tabbox numbers strings from low to high; GP5 numbers them from high to low.
pub fn tokens_to_score(tokens: &[String], bpm: u16, title: &str) -> Result<Score> {
    ensure!(tokens.len() <= 10000, "Zu viele OMR-Symbole.");
    let mut score = Score::new(title, bpm)?;
    let (mut numerator, mut denominator) = (4, 4);
    let mut bar: Option<Bar> = None;
    let mut beat: Option<Beat> = None;
    let mut unknown = BTreeSet::new();
    fn flush_beat(beat: &mut Option<Beat>, bar: &mut Option<Bar>, n: u8, d: u8) {
        if let Some(beat) = beat.take() {
            bar.get_or_insert_with(|| Bar {
                numerator: n,
                denominator: d,
                beats: vec![],
            })
            .beats
            .push(beat);
        }
    }
    for token in tokens {
        if token == "<UNK>" {
            bail!("Das OMR-Modell hat ein unbekanntes Symbol erkannt. Rohdaten prüfen.");
        }
        if token.starts_with('<') {
            continue;
        }
        match token.as_str() {
            "BAR" | "END_BAR" => {
                flush_beat(&mut beat, &mut bar, numerator, denominator);
                if let Some(bar) = bar.take() {
                    score.bars.push(bar);
                }
                if token == "BAR" {
                    bar = Some(Bar {
                        numerator,
                        denominator,
                        beats: vec![],
                    });
                }
                ensure!(score.bars.len() <= 500, "Maximal 500 Takte.");
            }
            "BEAT" => {
                flush_beat(&mut beat, &mut bar, numerator, denominator);
                beat = Some(Beat::default());
            }
            "REST" => {
                ensure!(
                    beat.as_ref().is_none_or(|b| b.notes.is_empty()),
                    "Pause und Noten im selben Beat."
                );
                beat.get_or_insert_default();
            }
            _ => {
                if let Some(v) = token.strip_prefix("TS_") {
                    flush_beat(&mut beat, &mut bar, numerator, denominator);
                    let (n, d) = v
                        .split_once('_')
                        .ok_or_else(|| anyhow::anyhow!("Ungültige Taktart."))?;
                    numerator = n.parse()?;
                    denominator = d.parse()?;
                    validate_meter(numerator, denominator)?;
                    if let Some(bar) = bar.as_mut() {
                        if bar.beats.is_empty() {
                            bar.numerator = numerator;
                            bar.denominator = denominator;
                        }
                    }
                } else if let Some(v) = token.strip_prefix("CAPO_") {
                    score.capo = v.parse()?;
                } else if let Some(v) = token
                    .strip_prefix("TEMPO_")
                    .filter(|v| v.chars().all(|c| c.is_ascii_digit()))
                {
                    score.tempo = v.parse()?;
                } else if let Some(v) = token.strip_prefix("DUR_") {
                    beat.get_or_insert_default().value = v.parse()?;
                } else if let Some(v) = token.strip_prefix("DOTS_") {
                    let dots: u8 = v.parse()?;
                    ensure!(
                        dots <= 1,
                        "Nicht unterstützter Notenwert: mehrere Punktierungen."
                    );
                    beat.get_or_insert_default().dotted = dots == 1;
                } else if let Some(v) = token.strip_prefix("TUPLET_") {
                    let (n, d) = v
                        .split_once('_')
                        .ok_or_else(|| anyhow::anyhow!("Ungültiges Tuplet."))?;
                    beat.get_or_insert_default().tuplet = Some((n.parse()?, d.parse()?));
                } else if let Some(v) = token.strip_prefix("N_S") {
                    let (string, fret) = v
                        .split_once("_F")
                        .ok_or_else(|| anyhow::anyhow!("Ungültige Note."))?;
                    let string: u8 = string.parse()?;
                    ensure!((1..=6).contains(&string), "Ungültige Saite.");
                    beat.get_or_insert_default().notes.push(Note {
                        string: 7 - string,
                        fret: if fret == "X" { 0 } else { fret.parse()? },
                        dead: fret == "X",
                    });
                } else {
                    unknown.insert(token.clone());
                }
            }
        }
    }
    flush_beat(&mut beat, &mut bar, numerator, denominator);
    if let Some(bar) = bar {
        score.bars.push(bar);
    }
    score.warnings.push("Experimentelle Bilderkennung: Ergebnis vor Verwendung prüfen. Stimmung ist Standardstimmung, sofern kein Kapodaster erkannt wurde.".into());
    if !unknown.is_empty() {
        score.warnings.push(format!(
            "Nicht vollständig übernommene Spieltechniken/Wiederholungen: {}",
            unknown.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }
    score.validate()?;
    Ok(score)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(s: &str) -> Result<Score> {
        tokens_to_score(
            &s.split_whitespace().map(str::to_owned).collect::<Vec<_>>(),
            120,
            "Test",
        )
    }
    #[test]
    fn string_mapping_and_dead_notes() {
        let s = parse("BAR BEAT DUR_1 N_S1_F3 N_S2_FX N_S6_F2 END_BAR").unwrap();
        assert_eq!(
            s.bars[0].beats[0].notes,
            vec![
                Note {
                    string: 6,
                    fret: 3,
                    dead: false
                },
                Note {
                    string: 5,
                    fret: 0,
                    dead: true
                },
                Note {
                    string: 1,
                    fret: 2,
                    dead: false
                }
            ]
        );
        assert_eq!(s.report()["notes"], 3);
        assert_eq!(s.report()["warnings"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn rejects_invalid_output() {
        for s in [
            "BAR BEAT DUR_4 N_S7_F0",
            "BAR BEAT DUR_4 N_S1_F40",
            "BAR BEAT DUR_4 N_S1_F2 N_S1_F3",
            "BAR BEAT DUR_4 DOTS_2 N_S1_F0",
            "BAR BEAT DUR_4 REST",
            "<UNK>",
            "BAR BEAT DUR_4 TUPLET_0_2 N_S1_F0",
        ] {
            assert!(parse(s).is_err(), "{s}");
        }
    }
    #[test]
    fn reports_incomplete_bars_and_techniques() {
        let s = parse("BAR BEAT DUR_4 DOTS_1 N_S1_F3 NTECH_SLIDE END_BAR").unwrap();
        let warnings = s.report()["warnings"].to_string();
        assert!(warnings.contains("Taktfüllung"));
        assert!(warnings.contains("NTECH_SLIDE"));
    }
    #[test]
    fn meter_and_tuplets() {
        let s = parse("TS_6_8 BAR BEAT DUR_4 DOTS_1 N_S1_F0 BEAT DUR_4 DOTS_1 N_S2_F0 END_BAR")
            .unwrap();
        assert_eq!(s.bars[0].numerator, 6);
        assert!(!s.report()["warnings"].to_string().contains("Taktfüllung"));
    }
}
