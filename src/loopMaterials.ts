import { invoke, isTauri } from '@tauri-apps/api/core';
import type { AnalysisResult } from './analysis';
import type { ScoreDocument, ScorePlaybackState } from './ScoreStudio';
type SavedScore = Omit<ScoreDocument, 'gp' | 'midi'> & { gp?: string; midi?: string };
export type LoopMaterial = { version: 1; analysis: AnalysisResult | null; score: SavedScore | null; scoreState: ScorePlaybackState | null; analysisTrack: number; offset: number };
export function samePassage(a: number | null, b: number | null, start: number, end: number) {
  return a !== null && b !== null && Math.abs(a-start)<.01 && Math.abs(b-end)<.06;
}
function encode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer), pieces: string[] = [];
  for (let i=0;i<bytes.length;i+=32768) pieces.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
  return btoa(pieces.join(''));
}
function decode(value: string): ArrayBuffer { return Uint8Array.from(atob(value), c=>c.charCodeAt(0)).buffer; }
export function serializeScore(doc: ScoreDocument): SavedScore {
  const {gp,midi,...rest}=doc;
  return {...rest,gp:gp?encode(gp):undefined,...(midi?{midi:encode(midi)}:{})};
}
export function restoreScore(doc: SavedScore): ScoreDocument {
  const {gp,midi,...rest}=doc;
  return {...rest,gp:gp?decode(gp):undefined,...(midi?{midi:decode(midi)}:{})};
}
export async function saveMaterial(value: LoopMaterial, project?: string | null): Promise<string> {
  const data=JSON.stringify(value);
  if (isTauri()) return project?invoke('save_project_material',{path:project,data}):invoke('save_loop_material',{data});
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
  const id=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
  localStorage.setItem('loopstudio.material.'+id,data); return id;
}
export async function loadMaterial(id: string, project?: string | null): Promise<LoopMaterial> {
  const data=isTauri()?(project?await invoke<string>('load_project_material',{path:project,id}):await invoke<string>('load_loop_material',{id})):localStorage.getItem('loopstudio.material.'+id);
  if (!data) throw new Error('Gespeicherte Notendaten fehlen.');
  const value=JSON.parse(data) as LoopMaterial;
  if(value.version!==1) throw new Error('Unbekanntes Notendatenformat.');
  return value;
}
export async function findCachedAnalysis(source: string, start: number,end: number):Promise<AnalysisResult|null> {
  return isTauri()?invoke('find_cached_analysis',{source,start,end}):null;
}
