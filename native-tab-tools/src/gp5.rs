//! Minimal GP5.00 serializer for the validated single-guitar recognition result.
//! Binary layout follows the PyGuitarPro GP3/GP5 format reference (LGPL-3.0).
use crate::score::{Beat, Score};
use anyhow::Result;

#[derive(Default)]
struct Writer(Vec<u8>);
impl Writer {
    fn byte(&mut self, v: u8) {
        self.0.push(v);
    }
    fn int(&mut self, v: i32) {
        self.0.extend(v.to_le_bytes());
    }
    fn short(&mut self, v: i16) {
        self.0.extend(v.to_le_bytes());
    }
    fn zeros(&mut self, n: usize) {
        self.0.resize(self.0.len() + n, 0);
    }
    fn text(value: &str, max: usize) -> Vec<u8> {
        value
            .chars()
            .filter(|c| !c.is_control())
            .filter_map(|c| u8::try_from(c as u32).ok())
            .take(max)
            .collect()
    }
    fn string(&mut self, v: &str) {
        let b = Self::text(v, 255);
        self.int(b.len() as i32 + 1);
        self.byte(b.len() as u8);
        self.0.extend(b);
    }
    fn fixed(&mut self, v: &str, n: usize) {
        let b = Self::text(v, n);
        self.byte(b.len() as u8);
        self.0.extend(&b);
        self.zeros(n - b.len());
    }
    fn beat(&mut self, b: &Beat) {
        let flags = u8::from(b.dotted)
            | if b.tuplet.is_some() { 0x20 } else { 0 }
            | if b.notes.is_empty() { 0x40 } else { 0 };
        self.byte(flags);
        if b.notes.is_empty() {
            self.byte(2);
        }
        self.byte((b.value.ilog2() as i8 - 2) as u8);
        if let Some((n, _)) = b.tuplet {
            self.int(n as i32);
        }
        self.byte(
            b.notes
                .iter()
                .fold(0, |mask, n| mask | (1 << (7 - n.string))),
        );
        for string in 1..=6 {
            if let Some(n) = b.notes.iter().find(|n| n.string == string) {
                self.byte(0x30);
                self.byte(if n.dead { 3 } else { 1 });
                self.byte(6);
                self.byte(n.fret);
                self.byte(0);
            }
        }
        self.short(0);
    }
}
pub fn write(score: &Score) -> Result<Vec<u8>> {
    score.validate()?;
    let mut w = Writer::default();
    w.fixed("FICHIER GUITAR PRO v5.00", 30);
    w.string(&score.title);
    for _ in 0..8 {
        w.string("");
    }
    w.int(0);
    // Lyrics: no track, five empty lyric lines.
    w.int(0);
    for _ in 0..5 {
        w.int(0);
        w.int(0);
    }
    // Page size, margins, print scale and header/footer templates.
    for v in [210, 297, 10, 10, 15, 10, 100] {
        w.int(v);
    }
    w.short(0);
    for _ in 0..10 {
        w.string("");
    }
    w.string("");
    w.int(score.tempo as i32);
    w.byte(0);
    w.int(0);
    for channel in 0..64 {
        w.int(if channel < 2 { 25 } else { 0 });
        w.0.extend([12, 8, 0, 0, 0, 0, 0, 0]);
    }
    for _ in 0..19 {
        w.short(-1);
    }
    w.int(0);
    w.int(score.bars.len() as i32);
    w.int(1);
    for (i, bar) in score.bars.iter().enumerate() {
        if i > 0 {
            w.byte(0);
        }
        let changed = i == 0
            || bar.numerator != score.bars[i - 1].numerator
            || bar.denominator != score.bars[i - 1].denominator;
        w.byte(if changed { 3 } else { 0 });
        if changed {
            w.byte(bar.numerator);
            w.byte(bar.denominator);
            w.0.extend([2, 2, 2, 2]);
        }
        w.byte(0);
        w.byte(0);
    }
    w.byte(0);
    w.byte(8);
    w.fixed("Guitar Tab", 40);
    w.int(6);
    for v in [64, 59, 55, 50, 45, 40, 0, 1, 1, 2, 36, score.capo as i32] {
        w.int(v);
    }
    w.0.extend([29, 78, 216, 0]);
    w.short(3);
    w.byte(0);
    w.byte(0);
    // RSE track block, GP5.00 variant.
    w.byte(0);
    w.int(0);
    w.int(0);
    w.int(100);
    w.zeros(12);
    w.int(-1);
    w.int(0);
    w.int(0);
    w.short(0);
    w.byte(0);
    w.zeros(2);
    for bar in &score.bars {
        w.int(bar.beats.len() as i32);
        for beat in &bar.beats {
            w.beat(beat);
        }
        w.int(0);
        w.byte(0);
    }
    Ok(w.0)
}
