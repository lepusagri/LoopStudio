import { invoke, isTauri } from '@tauri-apps/api/core';
import { tuning, type Note } from './music';

export type FingeringResult = { notes: Note[]; unassigned: number; extraVoices: number; wideGrips: number };
type Arrangement = { notes: { index: number; pitch: number; string: number; fret: number; guitar: number }[]; unassigned: number[]; extra_guitars: number; wide_grips: number };
const cache = new WeakMap<Note[], Promise<FingeringResult>>();

export function applyFingerings(notes: Note[], result: Arrangement): FingeringResult {
  const mapped = notes.map(n => ({ ...n, position: undefined } as Note));
  const seen = new Set<number>();
  for (const a of result.notes) {
    if (!Number.isInteger(a.index) || !notes[a.index] || seen.has(a.index) || !Number.isInteger(a.string) || a.string < 1 || a.string > 6 ||
        !Number.isInteger(a.fret) || a.fret < 0 || a.fret > 19 || !Number.isInteger(a.guitar) || a.guitar < 1 ||
        tuning[a.string - 1] + a.fret !== notes[a.index].midi || a.pitch !== notes[a.index].midi) throw new Error('Ungültige Griffzuordnung vom Modell.');
    seen.add(a.index);
    if(a.guitar>2)continue; // Preserve pitches from older workers without creating more voices.
    mapped[a.index].position = { string: a.string - 1, fret: a.fret, tuning, capo: 0, voice: a.guitar, source: 'model' };
  }
  for(let i=0;i<notes.length;i++)if(notes[i].position?.source==='manual'||notes[i].position?.source==='guitar-pro')mapped[i].position=notes[i].position;
  return { notes: mapped, unassigned: mapped.filter(n=>!n.position).length, extraVoices: mapped.some(n=>n.position?.voice===2)?1:0, wideGrips: result.wide_grips };
}

export function assignFingerings(notes: Note[]): Promise<FingeringResult> {
  const previous = cache.get(notes);
  if (previous) return previous;
  if (!isTauri()) return Promise.reject(new Error('Die KI-Griffberechnung ist in der Desktop-App verfügbar.'));
  const pending = invoke<Arrangement>('assign_fingerings', { notes: notes.map(n => ({ pitch: n.midi, start_s: n.time, end_s: n.time + n.duration, amplitude: n.velocity })) })
    .then(result => applyFingerings(notes, result));
  cache.set(notes, pending);
  void pending.catch(() => cache.delete(notes));
  return pending;
}
