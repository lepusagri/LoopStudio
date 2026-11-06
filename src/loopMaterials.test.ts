import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadMaterial, restoreScore, samePassage, saveMaterial, serializeScore, type LoopMaterial } from './loopMaterials';
import { parseGuitarPro } from './guitarPro';
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>false,invoke:vi.fn()}));
beforeEach(()=>{
  const storage=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)});
});
it('restores original GP5 bytes, positions, analysis tracks and passage alignment from a saved loop',async()=>{
  const bytes=Uint8Array.from(readFileSync(new URL('./fixtures/positions.gp5',import.meta.url))).buffer;
  const parsed=await parseGuitarPro(bytes);
  const doc={...parsed,id:'score',name:'positions.gp5',gp:bytes};
  const value:LoopMaterial={version:1,score:serializeScore(doc),scoreState:{track:0,start:.5,end:1.5,speed:.75,loop:true,alignment:{scoreStart:.5,scoreEnd:1.5,mediaStart:8,mediaEnd:10}},analysis:{version:2,start:8,end:10,stems:[{id:4,name:'Gitarre',source:'guitar',path:'guitar.wav',notes:parsed.notes,rms:.2,warning:null}]},analysisTrack:4,offset:8};
  const id=await saveMaterial(value);
  expect(await saveMaterial(value)).toBe(id);
  // Reload from serialized storage rather than retaining the original objects.
  const stored=await loadMaterial(id), restored=restoreScore(stored.score!);
  expect(new Uint8Array(restored.gp!)).toEqual(new Uint8Array(bytes));
  expect((await parseGuitarPro(restored.gp!)).notes).toEqual(parsed.notes);
  expect(stored.scoreState?.alignment?.mediaStart).toBe(8);
  expect(stored.analysis?.stems[0].notes).toEqual(parsed.notes);
  expect(stored.analysisTrack).toBe(4);
});
it('retains MIDI pitch, timing, track and duration without inventing GP data',async()=>{
  const doc={id:'midi',name:'test.mid',notes:[{midi:64,time:1.2,duration:.3,velocity:.8,track:2}],tracks:[{id:2,name:'Lead',count:1}],duration:2,bpm:120};
  expect(restoreScore(serializeScore(doc))).toEqual({...doc,gp:undefined});
  expect(samePassage(8,10,8,9.99)).toBe(true);
  expect(samePassage(18,20,8,10)).toBe(false);
});
it('reports a missing saved attachment',async()=>{
  await expect(loadMaterial('missing')).rejects.toThrow('fehlen');
});
