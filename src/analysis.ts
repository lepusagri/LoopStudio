import type { Note } from './music';
export type Stem = { id: number; source: string; name: string; path: string; audioOffset?: number; notes: Note[]; rms: number; warning: string | null };
export type AnalysisResult = { version: number; edited?:boolean; engine?: string; transcriber?: string; device?: string; start: number; end: number; stems: Stem[] };
export type StemLevel = { muted: boolean; solo: boolean; volume: number };
export function stemVolume(level: StemLevel, anySolo: boolean, master: number) {
  return level.muted || (anySolo && !level.solo) ? 0 : Math.max(0, Math.min(1, level.volume * master));
}
export function passagePosition(time: number, start: number, end: number) {
  return time >= start && time < end ? time - start : null;
}
