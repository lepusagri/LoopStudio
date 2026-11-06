import { Midi } from '@tonejs/midi';

export type Note = { midi: number; time: number; duration: number; velocity: number; track: number };
export type NoteTrack = { id: number; name: string; count: number };
export type Loop = { id: string; name: string; start: number; end: number };
export type Session = { key: string; loops: Loop[]; speed: number; offset: number };
export const tuning = [64, 59, 55, 50, 45, 40];
const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'H'];
export function noteName(midi: number, octave = false) { return names[((midi % 12) + 12) % 12] + (octave ? Math.floor(midi / 12) - 1 : ''); }
export function formatTime(seconds: number) {
  const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}.${Math.floor((value % 1) * 10)}`;
}
export function isActive(note: Note, time: number) { return note.time <= time && time < note.time + note.duration; }
export function validLoop(a: number | null, b: number | null, duration: number): boolean {
  return a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b - a >= 0.1 && b <= duration + 0.01;
}
export function loopTarget(time: number, a: number, b: number, enabled: boolean) {
  return enabled && (time >= b || time < a - 0.05) ? a : null;
}
export function parseMidi(buffer: ArrayBuffer): { notes: Note[]; tracks: NoteTrack[]; duration: number; bpm: number } {
  const midi = new Midi(buffer);
  const notes: Note[] = [];
  const tracks: NoteTrack[] = [];
  midi.tracks.forEach((track, id) => {
    if (!track.notes.length || track.instrument.percussion) return;
    tracks.push({ id, name: track.name || track.instrument.name || `Spur ${id + 1}`, count: track.notes.length });
    track.notes.forEach(note => notes.push({ midi: note.midi, time: note.time, duration: note.duration, velocity: note.velocity, track: id }));
  });
  notes.sort((a, b) => a.time - b.time);
  if (!notes.length) throw new Error('Diese MIDI-Datei enthält keine spielbaren Tonspuren.');
  if (notes.length > 200000) throw new Error('Die MIDI-Datei ist zu groß (maximal 200.000 Noten).');
  return { notes, tracks, duration: midi.duration, bpm: Math.round(midi.header.tempos[0]?.bpm || 120) };
}

export function demoNotes(): Note[] {
  const notes: Note[] = [];
  const chords = [[48, 52, 55, 60], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59]];
  for (let bar = 0; bar < 8; bar++) {
    const chord = chords[bar % 4];
    for (let step = 0; step < 8; step++) notes.push({ midi: chord[[0, 1, 2, 3, 2, 1, 2, 3][step]], time: bar * 2.4 + step * 0.3, duration: 0.48, velocity: step % 2 ? 0.55 : 0.8, track: 0 });
  }
  return notes;
}

// A small original demonstration, generated locally; no samples or network needed.
export function synthWav(notes: Note[], duration: number): { blob: Blob; samples: Float32Array } {
  const rate = 22050;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 300) throw new Error('MIDI-Solo-Wiedergabe unterstützt bis zu 5 Minuten. Für längere Stücke zuerst eine Audiodatei öffnen.');
  const renderWork = notes.reduce((sum, note) => sum + Math.min(note.duration, 8) + 0.15, 0);
  if (notes.length > 20000 || renderWork > 4500) throw new Error('Diese MIDI-Datei ist zu komplex für die einfache Solo-Synthese. Öffne zuerst die passende Audioaufnahme und lade dann die MIDI-Datei dazu.');
  const samples = new Float32Array(Math.ceil((duration + 0.5) * rate));
  for (const note of notes) {
    const start = Math.floor(note.time * rate);
    const length = Math.floor((Math.min(note.duration, 8) + 0.15) * rate);
    const frequency = 440 * 2 ** ((note.midi - 69) / 12);
    for (let j = 0; j < length && start + j < samples.length; j++) {
      const t = j / rate;
      const release = Math.max(0, Math.min(1, (note.duration + 0.15 - t) / 0.15));
      const envelope = Math.min(1, t / 0.008) * Math.exp(-t * 3) * release;
      samples[start + j] += (Math.sin(2 * Math.PI * frequency * t) + 0.25 * Math.sin(4 * Math.PI * frequency * t)) * envelope * note.velocity * 0.3;
    }
  }
  let peak = 1;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample / peak)) * 32767, true));
  return { blob: new Blob([buffer], { type: 'audio/wav' }), samples };
}

export function peaksFrom(samples: Float32Array, count = 600): number[] {
  const peaks = Array<number>(count).fill(0);
  const stride = samples.length / count;
  for (let i = 0; i < count; i++) {
    let peak = 0;
    for (let j = Math.floor(i * stride); j < Math.min(samples.length, (i + 1) * stride); j += Math.max(1, Math.floor(stride / 80))) peak = Math.max(peak, Math.abs(samples[j]));
    peaks[i] = peak;
  }
  const max = Math.max(0.01, ...peaks);
  return peaks.map(value => value / max);
}
