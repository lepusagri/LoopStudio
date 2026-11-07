import { invoke } from '@tauri-apps/api/core';
import type { ScoreDocument } from './ScoreStudio';
import { ensureGp7, updatedGp7 } from './gp7Document';

export type ExternalEdit = { sessionId: string; baselineHash: string; context: string };
type Exported = { sessionId: string; baselineHash: string; path: string };
type Imported = { gp: string; hash: string; path: string; backupPath: string };
export function encodeGp(bytes: ArrayBuffer): string {
  const values = new Uint8Array(bytes), parts: string[] = [];
  for (let i=0;i<values.length;i+=32768) parts.push(String.fromCharCode(...values.subarray(i,i+32768)));
  return btoa(parts.join(''));
}
export async function gpHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function assertCurrent(isCurrent:()=>boolean) {
  if (!isCurrent()) throw new Error('Der Loop oder die Partitur wurde gewechselt. Die externe Arbeitskopie bleibt erhalten.');
}
export async function exportExternalScore(document:ScoreDocument, context:string, project:string|undefined, isCurrent:()=>boolean) {
  const canonical = await ensureGp7(document);assertCurrent(isCurrent);
  const result = await invoke<Exported>('export_external_score',{project:project??null,documentId:document.id,context,gp:encodeGp(canonical.gp!)});
  assertCurrent(isCurrent);
  if (await gpHash(canonical.gp!) !== result.baselineHash) throw new Error('Die externe Arbeitskopie stimmt nicht mit der Partitur überein.');
  assertCurrent(isCurrent);
  return {document:{...canonical,externalEdit:{sessionId:result.sessionId,baselineHash:result.baselineHash,context}},path:result.path};
}
export async function prepareExternalImport(document:ScoreDocument, context:string, project:string|undefined, isCurrent:()=>boolean) {
  const edit = document.externalEdit;
  if (!edit || edit.context!==context || !document.gp || document.edited) throw new Error('Bitte diese Partitur zuerst in Guitar Pro öffnen.');
  if (await gpHash(document.gp) !== edit.baselineHash) throw new Error('Die Partitur wurde inzwischen in LoopStudio geändert. Bitte eine neue Arbeitskopie in Guitar Pro öffnen. Die bisherige externe Datei bleibt erhalten.');
  assertCurrent(isCurrent);
  const result = await invoke<Imported>('read_external_score',{project:project??null,sessionId:edit.sessionId,documentId:document.id,context,baselineHash:edit.baselineHash,gp:encodeGp(document.gp)});
  assertCurrent(isCurrent);
  const bytes = Uint8Array.from(atob(result.gp), c=>c.charCodeAt(0)).buffer;
  if (await gpHash(bytes) !== result.hash) throw new Error('Die externe Datei konnte nicht vollständig gelesen werden. Bitte erneut übernehmen.');
  assertCurrent(isCurrent);
  if (result.hash===edit.baselineHash) return {document:null,path:result.path,backupPath:result.backupPath};
  const next = await updatedGp7(document,bytes);assertCurrent(isCurrent);
  if (document.origin?.trackIds) {
    const previous=document.origin.trackIds;
    next.origin={...document.origin,trackIds:next.tracks.map(track=>{
      const matches=document.tracks.map((old,index)=>({old,index})).filter(({old})=>old.name===track.name);
      // A renamed/new/ambiguous track must not inherit another instrument's audio stem.
      return matches.length===1?previous[matches[0].index]??-1:-1;
    })};
  }
  return {document:{...next,externalEdit:{...edit,baselineHash:result.hash}},path:result.path,backupPath:result.backupPath};
}
