import { expect, it, vi } from 'vitest';
import { Midi } from '@tonejs/midi';
import { parseMidi } from './music';
import { restoreScore, serializeScore, loadMaterial, saveMaterial } from './loopMaterials';
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>false,invoke:vi.fn()}));
it('keeps original MIDI bytes and edited playback notes as separate parts of the saved practice document',async()=>{
  const midi=new Midi();midi.header.setTempo(92);midi.addTrack().addNote({midi:64,time:.5,duration:.7,velocity:.8});
  const bytes=Uint8Array.from(midi.toArray()).buffer;
  const doc={...parseMidi(bytes),id:'midi',name:'practice.mid',midi:bytes,edited:true};
  doc.notes=doc.notes.map(n=>({...n,midi:67}));
  const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k),setItem:(k:string,v:string)=>storage.set(k,v)});
  const id=await saveMaterial({version:1,score:serializeScore(doc),analysis:null,scoreState:null,analysisTrack:0,offset:0});
  const restored=restoreScore((await loadMaterial(id)).score!);
  expect(new Uint8Array(restored.midi!)).toEqual(new Uint8Array(bytes));
  expect(parseMidi(restored.midi!).notes[0].midi).toBe(64);
  expect(restored.notes[0].midi).toBe(67);
});
