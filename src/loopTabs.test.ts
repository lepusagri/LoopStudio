import {expect,it,vi} from 'vitest';
import {loopScoreFit,replaceScoreTrack,type TabDraft} from './loopTabs';
import {ensureGp7} from './gp7Document';
import {loadMaterial,saveMaterial,serializeScore} from './loopMaterials';
import type {ScoreDocument} from './ScoreStudio';
import type {Loop} from './music';
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>false,invoke:vi.fn()}));
const loop:Loop={id:'loop',name:'Riff',start:20,end:28,rhythm:{bpm:120,beatsPerBar:4,beatUnit:4,bars:4,firstBeat:0}};
const doc:ScoreDocument={id:'tabs',name:'Riff.gp',bpm:120,duration:8,barCount:4,meter:{numerator:4,denominator:4},notes:[],tracks:[]};
it('allows explicit alignment only after matching confirmed loop structure',()=>{
 expect(loopScoreFit(doc,loop).canAlign).toBe(true);
 expect(loopScoreFit({...doc,barCount:3},loop).canAlign).toBe(false);
 expect(loopScoreFit({...doc,meter:{numerator:3,denominator:4}},loop).canAlign).toBe(false);
 expect(loopScoreFit(doc,{...loop,rhythm:{...loop.rhythm!,firstBeat:undefined}}).canAlign).toBe(false);
});
it('retains images, assembled PDF, candidate and previous score after a saved loop is reopened',async()=>{
 const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key),setItem:(key:string,value:string)=>storage.set(key,value)});
 const tabDraft:TabDraft={clips:[{id:'clip',time:24,image:btoa('png-data')}],pdf:btoa('pdf-data'),candidate:serializeScore(doc),previousScore:serializeScore({...doc,id:'old'})};
 const id=await saveMaterial({version:1,analysis:null,score:serializeScore(doc),scoreState:null,analysisTrack:0,offset:20,tabDraft});
 expect((await loadMaterial(id)).tabDraft).toEqual(tabDraft);
});
it('replaces one score track while retaining the other instruments',async()=>{
 const original=await ensureGp7({...doc,duration:2,notes:[{midi:60,time:0,duration:2,velocity:.8,track:0},{midi:64,time:0,duration:2,velocity:.8,track:1}],tracks:[{id:0,name:'Piano',count:1},{id:1,name:'Lead',count:1}]});
 const incoming=await ensureGp7({...doc,duration:2,notes:[{midi:67,time:0,duration:2,velocity:.8,track:0}],tracks:[{id:0,name:'Neue Spur',count:1}]});
 const merged=await replaceScoreTrack(original,incoming,1);
 expect(merged.notes.filter(n=>n.track===0).map(n=>n.midi)).toEqual([60]);
 expect(merged.notes.filter(n=>n.track===1).map(n=>n.midi)).toEqual([67]);
 expect(merged.tracks.map(t=>t.name)).toEqual(['Piano','Lead']);
});
