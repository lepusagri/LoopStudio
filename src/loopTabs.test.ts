import {expect,it,vi} from 'vitest';
import {loopScoreFit,type TabDraft} from './loopTabs';
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
