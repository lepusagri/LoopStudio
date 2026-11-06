import { invoke, isTauri } from '@tauri-apps/api/core';
import type { AnalysisResult } from './analysis';
import type { ScoreDocument, ScorePlaybackState } from './ScoreStudio';
type SavedScore = Omit<ScoreDocument, 'gp'> & { gp?: string };
export type LoopMaterial = { version: 1; analysis: AnalysisResult | null; score: SavedScore | null; scoreState: ScorePlaybackState | null; analysisTrack: number; offset: number };
export function samePassage(a: number | null, b: number | null, start: number, end: number) {
  return a !== null && b !== null && Math.abs(a-start)<.01 && Math.abs(b-end)<.06;
}
export function serializeScore(doc: ScoreDocument): SavedScore {
  if (!doc.gp) return { ...doc, gp: undefined };
  const bytes = new Uint8Array(doc.gp), pieces: string[] = [];
  for (let i=0;i<bytes.length;i+=32768) pieces.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
  return { ...doc, gp: btoa(pieces.join('')) };
}
export function restoreScore(doc: SavedScore): ScoreDocument {
  return { ...doc, gp: doc.gp ? Uint8Array.from(atob(doc.gp), c=>c.charCodeAt(0)).buffer : undefined };
}
export async function saveMaterial(value: LoopMaterial): Promise<string> {
  const data=JSON.stringify(value);
  if (isTauri()) return invoke('save_loop_material',{data});
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
  const id=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
  localStorage.setItem('loopstudio.material.'+id,data); return id;
}
export async function loadMaterial(id: string): Promise<LoopMaterial> {
  const data=isTauri()?await invoke<string>('load_loop_material',{id}):localStorage.getItem('loopstudio.material.'+id);
  if (!data) throw new Error('Gespeicherte Notendaten fehlen.');
  const value=JSON.parse(data) as LoopMaterial;
  if(value.version!==1) throw new Error('Unbekanntes Notendatenformat.');
  return value;
}
export async function findCachedAnalysis(source: string, start: number,end: number):Promise<AnalysisResult|null> {
  return isTauri()?invoke('find_cached_analysis',{source,start,end}):null;
}
