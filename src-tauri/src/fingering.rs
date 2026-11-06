// Adapted from the user-owned AutoTab-Rust fingering implementation.
//! Pretrained scoring and bounded fingering search. Extra voices preserve excess notes.
use crate::tab::Tuning;
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NoteEvent { pub pitch: u8, pub start_s: f64, pub end_s: f64, pub amplitude: f64 }

use ort::{environment::Environment, value::TensorRef};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::Path, rc::Rc, time::Duration};

pub const MODEL: &str = "tab-labeler-v3-egset.onnx";
pub const REVISION: &str = "434976baacaf194d99f09c3c784682766bedcf97";
const HASH: &str = "93114786c6f4781e7a0b69abd7e93a0d4966873f8e54908f97a1de8e8cf788af";
const BEAM: usize = 64;

#[derive(Clone, Copy, Debug, Default, Serialize)]
pub enum Engine {
    #[default]
    V3,

}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Assigned {
    pub index: usize,
    pub pitch: u8,
    pub start_s: f64,
    pub end_s: f64,
    pub amplitude: f64,
    pub string: u8,
    pub fret: u8,
    pub guitar: usize,
}

#[derive(Default, Serialize, Deserialize)]
pub struct Arrangement {
    pub notes: Vec<Assigned>,
    pub unassigned: Vec<usize>,
    pub outside_model_range: usize,
    pub extra_guitars: usize,
    pub wide_grips: usize,
}

pub fn model_path(home: &Path) -> Result<std::path::PathBuf> {
    let path = home.join("models").join(MODEL);
    if path.is_file() && format!("{:x}", Sha256::digest(fs::read(&path)?)) == HASH {
        return Ok(path);
    }
    println!("  Downloading pretrained tab-labeler v3 (1.3 MB, CC BY 4.0)...");
    fs::create_dir_all(path.parent().unwrap())?;
    let url = format!("https://huggingface.co/cstr/tab-labeler-onnx/resolve/{REVISION}/{MODEL}");
    let mut response = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(120))
        .build()?
        .get(url)
        .send()?
        .error_for_status()?;
    let mut temporary = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
    response.copy_to(&mut temporary)?;
    ensure!(
        format!("{:x}", Sha256::digest(fs::read(temporary.path())?)) == HASH,
        "Tab-labeler model checksum mismatch"
    );
    temporary.persist(&path).map_err(|error| error.error)?;
    Ok(path)
}

fn groups(notes: &[NoteEvent]) -> Vec<Vec<usize>> {
    let mut order: Vec<_> = (0..notes.len()).collect();
    order.sort_by(|&a, &b| {
        notes[a]
            .start_s
            .total_cmp(&notes[b].start_s)
            .then(notes[a].pitch.cmp(&notes[b].pitch))
    });
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for index in order {
        if let Some(group) = groups
            .last_mut()
            .filter(|group| notes[index].start_s - notes[group[0]].start_s < 0.05)
        {
            group.push(index);
        } else {
            groups.push(vec![index]);
        }
    }
    groups
}

fn features(notes: &[NoteEvent], groups: &[Vec<usize>]) -> Vec<f32> {
    let mut data = vec![0.0; groups.len() * 49 * 9];
    for column in 0..groups.len() {
        for offset in 0..9 {
            let context = column as isize + offset as isize - 4;
            if !(0..groups.len() as isize).contains(&context) {
                continue;
            }
            for &index in &groups[context as usize] {
                if (40..=88).contains(&notes[index].pitch) {
                    data[(column * 49 + usize::from(notes[index].pitch - 40)) * 9 + offset] = 1.0;
                }
            }
        }
    }
    data
}

pub fn run(
    notes: &[NoteEvent],
    tuning: Tuning,
    engine: Engine,
    home: &Path,
    environment: &Environment,
) -> Result<Arrangement> {
    if notes.is_empty() {
        return Ok(Arrangement::default());
    }
    for note in notes {
        ensure!(
            note.start_s.is_finite()
                && note.end_s.is_finite()
                && note.amplitude.is_finite()
                && note.start_s >= 0.0
                && note.end_s > note.start_s,
            "Invalid guitar note timing"
        );
    }
    let groups = groups(notes);
    let scores = if matches!(engine, Engine::V3) {
        let path = model_path(home)?;
        let mut session = ort::session::Session::builder(environment)?.with_intra_threads(2).map_err(|e| anyhow::anyhow!(e.to_string()))?.commit_from_file(path)?;
        // Bound temporary model input memory even for long recordings.
        let mut scores = Vec::with_capacity(groups.len() * 126);
        for start in (0..groups.len()).step_by(512) {
            let end = (start + 512).min(groups.len());
            let context_start = start.saturating_sub(4);
            let context_end = (end + 4).min(groups.len());
            let input = features(notes, &groups[context_start..context_end]);
            let row_start = (start - context_start) * 49 * 9;
            let input = &input[row_start..row_start + (end - start) * 49 * 9];
            let tensor = TensorRef::from_array_view(([end - start, 49, 9, 1], input))?;
            let output = session.run(ort::inputs!["input" => tensor])?;
            let (shape, data) = output["output"].try_extract_tensor::<f32>()?;
            ensure!(
                shape.as_ref() == [(end - start) as i64, 6, 21]
                    && data.iter().all(|x| x.is_finite()),
                "Invalid tab-labeler model output"
            );
            scores.extend_from_slice(data);
        }
        Some(scores)
    } else {
        None
    };
    let result = search(notes, &groups, scores.as_deref(), tuning)?;
    if tuning != Tuning::Standard && matches!(engine, Engine::V3) {
        println!(
            "  v3 was trained for standard tuning; other tunings are experimental. Out-of-range pitches use rule-based costs."
        );
    }
    println!(
        "  Fingering: {} assigned, {} unassigned (retained in MIDI), {} extra guitars, {} outside model pitch range",
        result.notes.len(),
        result.unassigned.len(),
        result.extra_guitars,
        result.outside_model_range
    );
    Ok(result)
}

#[derive(Clone)]
struct Placement {
    items: Vec<(usize, u8, u8)>,
    cost: f64,
    position: u8,
}
#[derive(Clone)]
struct History {
    previous: Option<Rc<History>>,
    items: Vec<(usize, u8, u8)>,
}
impl Drop for History {
    fn drop(&mut self) {
        let mut previous = self.previous.take();
        while let Some(node) = previous {
            match Rc::try_unwrap(node) {
                Ok(mut node) => previous = node.previous.take(),
                Err(_) => break,
            }
        }
    }
}
#[derive(Clone)]
struct State {
    cost: f64,
    active: [i64; 6],
    frets: [u8; 6],
    position: u8,
    history: Option<Rc<History>>,
}
fn micros(time: f64) -> i64 {
    (time * 1_000_000.0).round() as i64
}

fn span(frets: impl Iterator<Item = u8>) -> u8 {
    let frets: Vec<_> = frets.filter(|&f| f > 0).collect();
    frets.iter().max().copied().unwrap_or(0) - frets.iter().min().copied().unwrap_or(0)
}

fn enumerate(
    notes: &[NoteEvent],
    group: &[usize],
    tuning: &[u8; 6],
    score: Option<&[f32]>,
) -> Vec<Placement> {
    struct Enumerator<'a> {
        notes: &'a [NoteEvent],
        group: &'a [usize],
        tuning: &'a [u8; 6],
        score: Option<&'a [f32]>,
        result: Vec<Placement>,
    }
    impl Enumerator<'_> {
        fn visit(&mut self, items: &mut Vec<(usize, u8, u8)>, used: u8, cost: f64) {
            if items.len() == self.group.len() {
                let frets: Vec<_> = items
                    .iter()
                    .filter_map(|&(_, _, f)| (f > 0).then_some(f))
                    .collect();
                let low = frets.iter().copied().min().unwrap_or(0);
                let high = frets.iter().copied().max().unwrap_or(0);
                if high - low <= 7 {
                    self.result.push(Placement {
                        items: items.clone(),
                        cost: cost + 0.5 * f64::from(high - low),
                        position: low,
                    });
                }
                return;
            }
            let index = self.group[items.len()];
            for string in 0..6 {
                if used & (1 << string) != 0 {
                    continue;
                }
                let Some(fret) = self.notes[index]
                    .pitch
                    .checked_sub(self.tuning[string])
                    .filter(|&f| f <= 19)
                else {
                    continue;
                };
                let local = self
                    .score
                    .filter(|_| (40..=88).contains(&self.notes[index].pitch))
                    .map_or(f64::from(fret) * 0.03, |s| {
                        f64::from(s[string * 21] - s[string * 21 + usize::from(fret) + 1])
                    });
                items.push((index, string as u8 + 1, fret));
                self.visit(items, used | 1 << string, cost + local);
                items.pop();
            }
        }
    }
    let mut enumeration = Enumerator {
        notes,
        group,
        tuning,
        score,
        result: vec![],
    };
    enumeration.visit(&mut Vec::new(), 0, 0.0);
    enumeration.result
}

fn advance(notes: &[NoteEvent], beam: &[State], choices: &[Placement]) -> Vec<State> {
    let mut states: BTreeMap<([i64; 6], [u8; 6], u8), State> = BTreeMap::new();
    for previous in beam {
        for choice in choices {
            if choice.items.iter().any(|&(index, string, _)| {
                previous.active[usize::from(string - 1)] > micros(notes[index].start_s)
            }) {
                continue;
            }
            let mut active = previous.active;
            let mut frets = previous.frets;
            let onset = choice
                .items
                .iter()
                .map(|&(i, _, _)| micros(notes[i].start_s))
                .min()
                .unwrap_or(0);
            for string in 0..6 {
                if active[string] <= onset {
                    active[string] = 0;
                    frets[string] = 0;
                }
            }
            for &(index, string, fret) in &choice.items {
                active[usize::from(string - 1)] = micros(notes[index].end_s);
                frets[usize::from(string - 1)] = fret;
            }
            if span(frets.into_iter()) > 7 {
                continue;
            }
            let position = if choice.position == 0 {
                previous.position
            } else {
                choice.position
            };
            let cost = previous.cost
                + choice.cost
                + 0.35 * f64::from(position.abs_diff(previous.position));
            let key = (active, frets, position);
            if states.get(&key).is_none_or(|state| state.cost > cost) {
                states.insert(
                    key,
                    State {
                        cost,
                        active,
                        frets,
                        position,
                        history: Some(Rc::new(History {
                            previous: previous.history.clone(),
                            items: choice.items.clone(),
                        })),
                    },
                );
            }
        }
    }
    let mut result: Vec<_> = states.into_values().collect();
    result.sort_by(|a, b| a.cost.total_cmp(&b.cost));
    result.truncate(BEAM);
    result
}

fn assigned(notes: &[NoteEvent], index: usize, string: u8, fret: u8, guitar: usize) -> Assigned {
    let n = &notes[index];
    Assigned {
        index,
        pitch: n.pitch,
        start_s: n.start_s,
        end_s: n.end_s,
        amplitude: n.amplitude as f64,
        string,
        fret,
        guitar,
    }
}

fn search(
    notes: &[NoteEvent],
    groups: &[Vec<usize>],
    scores: Option<&[f32]>,
    tuning: Tuning,
) -> Result<Arrangement> {
    let mut strings = tuning.pitches();
    strings.reverse();
    let mut result = Arrangement {
        outside_model_range: notes
            .iter()
            .filter(|n| !(40..=88).contains(&n.pitch))
            .count(),
        ..Default::default()
    };
    let mut beam = vec![State {
        cost: 0.0,
        active: [0; 6],
        frets: [0; 6],
        position: 1,
        history: None,
    }];
    let mut extras = Vec::new();
    for (column, group) in groups.iter().enumerate() {
        let score = scores.map(|s| &s[column * 126..(column + 1) * 126]);
        let mut selected: Vec<_> = group
            .iter()
            .copied()
            .filter(|&i| {
                let playable = strings
                    .iter()
                    .any(|&s| notes[i].pitch.checked_sub(s).is_some_and(|f| f <= 19));
                if !playable {
                    result.unassigned.push(i);
                }
                playable
            })
            .collect();
        selected.sort_by_key(|&i| notes[i].pitch);
        loop {
            if selected.is_empty() {
                break;
            }
            let next = if selected.len() <= 6 {
                advance(notes, &beam, &enumerate(notes, &selected, &strings, score))
            } else {
                vec![]
            };
            if !next.is_empty() {
                beam = next;
                break;
            }
            // Keep outer voices where possible; retain each displaced inner voice separately.
            let remove = selected.len() / 2;
            extras.push((selected.remove(remove), column));
        }
    }
    let mut history = beam.first().and_then(|s| s.history.clone());
    while let Some(node) = history {
        result.notes.extend(
            node.items
                .iter()
                .map(|&(index, string, fret)| assigned(notes, index, string, fret, 1)),
        );
        history = node.previous.clone();
    }
    struct ExtraVoice {
        active: [i64; 6],
        frets: [u8; 6],
        position: u8,
    }
    let mut voices: Vec<ExtraVoice> = Vec::new();
    extras.sort_by(|a, b| notes[a.0].start_s.total_cmp(&notes[b.0].start_s));
    for (index, column) in extras {
        let score = scores.map(|s| &s[column * 126..(column + 1) * 126]);
        let choices = enumerate(notes, &[index], &strings, score);
        let mut best: Option<(f64, usize, &Placement)> = None;
        for (voice, state) in voices.iter().enumerate() {
            for choice in &choices {
                let (_, string, fret) = choice.items[0];
                let onset = micros(notes[index].start_s);
                if state.active[usize::from(string - 1)] > onset {
                    continue;
                }
                let sounding = state
                    .frets
                    .iter()
                    .enumerate()
                    .filter_map(|(s, &f)| (state.active[s] > onset).then_some(f));
                if span(sounding.chain(std::iter::once(fret))) > 7 {
                    continue;
                }
                let cost = choice.cost + 0.35 * f64::from(choice.position.abs_diff(state.position));
                if best.as_ref().is_none_or(|b| cost < b.0) {
                    best = Some((cost, voice, choice));
                }
            }
        }
        let (voice, choice) = if let Some((_, voice, choice)) = best {
            (voice, choice)
        } else {
            voices.push(ExtraVoice {
                active: [0; 6],
                frets: [0; 6],
                position: 1,
            });
            (
                voices.len() - 1,
                choices
                    .iter()
                    .min_by(|a, b| a.cost.total_cmp(&b.cost))
                    .context("Missing extra-voice fingering")?,
            )
        };
        let (_, string, fret) = choice.items[0];
        voices[voice].active[usize::from(string - 1)] = micros(notes[index].end_s);
        voices[voice].frets[usize::from(string - 1)] = fret;
        voices[voice].position = choice.position;
        result
            .notes
            .push(assigned(notes, index, string, fret, voice + 2));
    }
    result.extra_guitars = voices.len();
    result.notes.sort_by_key(|n| n.index);
    let mut onsets = BTreeMap::<(usize, i64), Vec<&Assigned>>::new();
    for note in &result.notes {
        onsets
            .entry((note.guitar, micros(note.start_s)))
            .or_default()
            .push(note);
    }
    let mut sounding = BTreeMap::<usize, [(i64, u8); 6]>::new();
    for ((guitar, onset), chord) in onsets {
        let active = sounding.entry(guitar).or_insert([(0, 0); 6]);
        for slot in active.iter_mut() {
            if slot.0 <= onset {
                *slot = (0, 0);
            }
        }
        for note in chord {
            active[usize::from(note.string - 1)] = (micros(note.end_s), note.fret);
        }
        result.wide_grips += usize::from(span(active.iter().map(|slot| slot.1)) > 4);
    }
    ensure!(
        result.notes.len() + result.unassigned.len() == notes.len(),
        "Fingering lost input notes"
    );
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn note(pitch: u8, start: f64, end: f64) -> NoteEvent {
        NoteEvent {
            pitch,
            start_s: start,
            end_s: end,
            amplitude: 0.8,
        }
    }
    #[test]
    fn context_and_score_classes_match_model_contract() {
        let notes = [note(40, 0.0, 0.5), note(88, 1.0, 1.5)];
        let input = features(&notes, &groups(&notes));
        assert_eq!(input[4], 1.0);
        assert_eq!(input[48 * 9 + 5], 1.0);
        let notes = [note(64, 0.0, 0.5)];
        let mut scores = vec![0.0; 126];
        scores[21 + 6] = 20.0;
        let result = search(&notes, &groups(&notes), Some(&scores), Tuning::Standard).unwrap();
        assert_eq!((result.notes[0].string, result.notes[0].fret), (2, 5));
    }
    #[test]
    fn alternate_tuning_keeps_low_notes_outside_the_model_range() {
        let notes = [note(38, 0.0, 0.5)];
        let scores = [0.0; 126];
        let result = search(&notes, &groups(&notes), Some(&scores), Tuning::DropD).unwrap();
        assert_eq!((result.notes[0].string, result.notes[0].fret), (6, 0));
        assert_eq!(result.outside_model_range, 1);
        assert!(
            search(&notes, &groups(&notes), Some(&scores), Tuning::Standard)
                .unwrap()
                .notes
                .is_empty()
        );
    }
    #[test]
    fn retains_seven_note_chords_sustains_and_unplayable_notes() {
        let mut notes: Vec<_> = [43, 50, 55, 58, 59, 62, 67]
            .into_iter()
            .map(|p| note(p, 0.0, 1.0))
            .collect();
        notes.push(note(64, 0.5, 1.5));
        notes.push(note(20, 2.0, 2.5));
        let result = search(&notes, &groups(&notes), None, Tuning::Standard).unwrap();
        assert_eq!(result.notes.len(), 8);
        assert_eq!(result.unassigned, [8]);
        assert!(result.extra_guitars >= 1);
        for a in &result.notes {
            for b in &result.notes {
                if a.index != b.index && a.guitar == b.guitar && a.string == b.string {
                    assert!(a.end_s <= b.start_s || b.end_s <= a.start_s);
                }
            }
        }
    }

}
