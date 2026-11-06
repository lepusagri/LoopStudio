import type { Note, NoteTrack } from './music';

// alphaTab unfolds repeats and applies tempo changes and sounding-pitch transposition.
// Capture its playback events directly so primary/secondary MIDI channels stay one GP track.
export async function parseGuitarPro(buffer: ArrayBuffer) {
  const { importer, midi, Settings } = await import('@coderline/alphatab');
  const settings = new Settings();
  const score = importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(buffer), settings);
  const file = new midi.MidiFile();
  const handler = new midi.AlphaSynthMidiFileHandler(file, true);
  const events: { track: number; start: number; end: number; midi: number; velocity: number }[] = [];
  const tempos = new Map<number, number>([[0, score.tempo || 120]]);
  let endTick = 0;
  handler.addNote = (track, start, length, key, velocity, channel) => {
    if (channel === 9 || length <= 0) return;
    if (events.length >= 200000) throw new Error('Maximal 200.000 Noten pro Datei.');
    events.push({ track, start, end: start + length, midi: key, velocity: velocity / 127 });
    endTick = Math.max(endTick, start + length);
  };
  handler.addTempo = (tick, tempo) => { if (tempo > 0) tempos.set(tick, tempo); };
  handler.finishTrack = (_track, tick) => { endTick = Math.max(endTick, tick); };
  const generator = new midi.MidiFileGenerator(score, settings, handler);
  generator.applyTranspositionPitches = true;
  generator.generate();
  const segments = [...tempos].sort((a, b) => a[0] - b[0]).map(([tick, bpm]) => ({ tick, bpm, seconds: 0 }));
  for (let i = 1; i < segments.length; i++) {
    const previous = segments[i - 1];
    segments[i].seconds = previous.seconds + (segments[i].tick - previous.tick) / file.division * 60 / previous.bpm;
  }
  const seconds = (tick: number) => {
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (segments[mid].tick <= tick) lo = mid; else hi = mid - 1; }
    const s = segments[lo]; return s.seconds + (tick - s.tick) / file.division * 60 / s.bpm;
  };
  const notes: Note[] = events.map(e => ({ midi: e.midi, track: e.track, time: seconds(e.start), duration: seconds(e.end) - seconds(e.start), velocity: e.velocity })).sort((a, b) => a.time - b.time);
  const tracks: NoteTrack[] = score.tracks.map(t => ({ id: t.index, name: t.name || `Spur ${t.index + 1}`, count: notes.filter(n => n.track === t.index).length })).filter(t => t.count > 0);
  if (!notes.length) throw new Error('Diese Guitar-Pro-Datei enthält keine spielbaren Tonspuren.');
  return { notes, tracks, duration: seconds(endTick), bpm: score.tempo };
}
