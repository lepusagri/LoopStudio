import { readFileSync } from 'node:fs';
import { expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { importer, Settings } from '@coderline/alphatab';
import { exportGp7 } from './gp7Export';
import { ensureGp7, reconcileScoreState } from './gp7Document';
import { parseGuitarPro } from './guitarPro';
import { restoreScore, serializeScore } from './loopMaterials';
import { encodeGp, exportExternalScore, gpHash, prepareExternalImport } from './externalScore';
import type { ScoreDocument } from './ScoreStudio';

vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn(),isTauri:()=>false}));
beforeEach(()=>vi.mocked(invoke).mockReset());
async function document():Promise<ScoreDocument>{
  const bytes=Uint8Array.from(readFileSync(new URL('./fixtures/positions.gp5',import.meta.url))).buffer;
  return ensureGp7({...await parseGuitarPro(bytes),gp:bytes,id:'document-1',name:'Practice.gp5'});
}
async function linked(){
  const doc=await document();
  return {...doc,externalEdit:{sessionId:'score-abc123',baselineHash:await gpHash(doc.gp!),context:'loop:1'}};
}
async function pitchEdit(doc:ScoreDocument){
  const settings=new Settings(),score=importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(doc.gp!),settings);
  const note=score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];note.fret+=1;
  score.finish(settings);return exportGp7(score,settings).slice().buffer;
}
it('exports the complete GP7 score and persists a portable link through serialization',async()=>{
  const doc=await document(),baseline=await gpHash(doc.gp!);
  vi.mocked(invoke).mockResolvedValueOnce({sessionId:'score-new123',baselineHash:baseline,path:'C:/Project/assets/external-editor/score-new123/Loop-Partitur.gp'});
  const exported=await exportExternalScore(doc,'loop:1','C:/Project/project.loopstudio',()=>true);
  expect(invoke).toHaveBeenCalledWith('export_external_score',expect.objectContaining({documentId:doc.id,context:'loop:1',project:'C:/Project/project.loopstudio',gp:encodeGp(doc.gp!)}));
  const restored=restoreScore(serializeScore(exported.document));
  expect(restored.externalEdit).toEqual({sessionId:'score-new123',baselineHash:baseline,context:'loop:1'});
  expect(JSON.stringify(restored.externalEdit)).not.toContain('C:/');
  expect(doc.externalEdit).toBeUndefined();
});
it('imports changed notes into the same document and retains the pitch-only alignment',async()=>{
  const doc=await linked(),bytes=await pitchEdit(doc),hash=await gpHash(bytes);
  vi.mocked(invoke).mockResolvedValueOnce({gp:encodeGp(bytes),hash,path:'working.gp',backupPath:'history/previous.gp'});
  const imported=await prepareExternalImport(doc,'loop:1',undefined,()=>true),next=imported.document!;
  expect(next.id).toBe(doc.id);expect(next.gp).toEqual(bytes);expect(next.notes[0].midi).toBe(doc.notes[0].midi+1);
  expect(next.externalEdit?.baselineHash).toBe(hash);expect(doc.externalEdit.baselineHash).not.toBe(hash);
  const state={track:0,start:0,end:doc.duration,speed:1,loop:false,alignment:{scoreStart:0,scoreEnd:doc.duration,mediaStart:10,mediaEnd:20}};
  expect(reconcileScoreState(doc,next,state)?.alignment).toEqual(state.alignment);
});
it('clears synchronization for external timing edits without changing the media boundaries',async()=>{
  const doc=await linked(),settings=new Settings(),score=importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(doc.gp!),settings);score.masterBars[0].tempoAutomations[0].value=90;score.finish(settings);
  const bytes=exportGp7(score,settings).slice().buffer;
  vi.mocked(invoke).mockResolvedValueOnce({gp:encodeGp(bytes),hash:await gpHash(bytes),path:'working.gp',backupPath:'history/previous.gp'});
  const next=(await prepareExternalImport(doc,'loop:1',undefined,()=>true)).document!;
  const alignment={scoreStart:0,scoreEnd:doc.duration,mediaStart:10,mediaEnd:20};
  expect(reconcileScoreState(doc,next,{track:0,start:0,end:doc.duration,speed:1,loop:false,alignment})?.alignment).toBeNull();
  expect(alignment.mediaStart).toBe(10);expect(alignment.mediaEnd).toBe(20);
});
it('does not import unchanged files or overwrite intervening internal edits',async()=>{
  const doc=await linked();
  vi.mocked(invoke).mockResolvedValueOnce({gp:encodeGp(doc.gp!),hash:doc.externalEdit.baselineHash,path:'working.gp',backupPath:'history/previous.gp'});
  expect((await prepareExternalImport(doc,'loop:1',undefined,()=>true)).document).toBeNull();
  vi.mocked(invoke).mockReset();
  await expect(prepareExternalImport({...doc,gp:await pitchEdit(doc)},'loop:1',undefined,()=>true)).rejects.toThrow('inzwischen in LoopStudio geändert');
  expect(invoke).not.toHaveBeenCalled();
  await expect(prepareExternalImport(doc,'loop:2',undefined,()=>true)).rejects.toThrow('zuerst in Guitar Pro öffnen');
});
it('does not attach an externally renamed instrument to a different analysis stem',async()=>{
  const original=await linked(),doc={...original,origin:{kind:'analysis' as const,start:10,end:20,trackIds:[4]}};
  const settings=new Settings(),score=importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(doc.gp!),settings);
  score.tracks[0].name='New instrument';score.finish(settings);
  const bytes=exportGp7(score,settings).slice().buffer;
  vi.mocked(invoke).mockResolvedValueOnce({gp:encodeGp(bytes),hash:await gpHash(bytes),path:'working.gp',backupPath:'history/previous.gp'});
  const next=(await prepareExternalImport(doc,'loop:1',undefined,()=>true)).document!;
  expect(next.origin?.trackIds).toEqual([-1]);
});
it('rejects corrupt results and discards late reads after a loop switch',async()=>{
  const doc=await linked(),broken=new TextEncoder().encode('broken').buffer;
  vi.mocked(invoke).mockResolvedValueOnce({gp:encodeGp(broken),hash:await gpHash(broken),path:'working.gp',backupPath:'history/previous.gp'});
  await expect(prepareExternalImport(doc,'loop:1',undefined,()=>true)).rejects.toThrow();
  let current=true;
  vi.mocked(invoke).mockImplementationOnce(async()=>{current=false;return {gp:encodeGp(doc.gp!),hash:doc.externalEdit.baselineHash,path:'working.gp',backupPath:'history/previous.gp'};});
  await expect(prepareExternalImport(doc,'loop:1',undefined,()=>current)).rejects.toThrow('gewechselt');
  expect(await gpHash(doc.gp!)).toBe(doc.externalEdit.baselineHash);
});
