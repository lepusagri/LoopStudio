import { expect,it,vi } from 'vitest';
import { serializeScore, restoreScore, saveMaterial, loadMaterial } from './loopMaterials';
import { editedNote } from './noteEditing';
import type { Note } from './music';
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>false,invoke:vi.fn()}));
it('reopens the edited GP working copy with its original template, changed pitch and manual position',async()=>{
  const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k),setItem:(k:string,v:string)=>storage.set(k,v)});
  const original:Note={midi:64,time:0,duration:.5,velocity:.8,track:0};
  const changed=editedNote(original,{midi:66,time:.1,duration:.25,velocity:.7,string:0,fret:2},2);
  const doc={id:'gp',name:'song.gp5',gp:Uint8Array.from([1,2,3]).buffer,edited:true,notes:[changed],tracks:[{id:0,name:'Gitarre',count:1}],duration:2,bpm:120};
  const id=await saveMaterial({version:1,analysis:null,score:serializeScore(doc),scoreState:null,analysisTrack:-1,offset:0});
  const restored=restoreScore((await loadMaterial(id)).score!);
  expect(restored.edited).toBe(true);expect(restored.notes[0]).toEqual(changed);
  expect(new Uint8Array(restored.gp!)).toEqual(Uint8Array.from([1,2,3]));
});
