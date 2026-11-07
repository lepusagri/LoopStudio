import type { Note } from './music';
export type InstrumentSelection = 'all' | 'guitar' | 'piano';
export const instrumentSelections:Record<InstrumentSelection,string>={all:'Alle Instrumente',guitar:'Nur Gitarre',piano:'Nur Piano'};
export type Stem = { id: number; source: string; name: string; path: string; audioOffset?: number; notes: Note[]; rms: number; warning: string | null };
export type AnalysisResult = { version: number; edited?:boolean; engine?: string; transcriber?: string; device?: string; instruments?:InstrumentSelection; start: number; end: number; stems: Stem[] };
export type StemLevel = { muted: boolean; solo: boolean; volume: number };
export function stemVolume(level: StemLevel, anySolo: boolean, master: number) {
  return level.muted || (anySolo && !level.solo) ? 0 : Math.max(0, Math.min(1, level.volume * master));
}
export function passagePosition(time: number, start: number, end: number) {
  return time >= start && time < end ? time - start : null;
}
