import {expect,it} from 'vitest';
import {analysisForRange,loopForScore} from './loopResize';
import type {Loop} from './music';
import type {ScoreDocument} from './ScoreStudio';
const loop:Loop={id:'test',name:'Test',start:1.854127,end:6.069395,materialId:'existing',rhythm:{bpm:122,beatsPerBar:4,beatUnit:4,bars:2,firstBeat:.15963718820861678}};
const score:ScoreDocument={id:'pdf',name:'Tabs',duration:3.9344262295081966,bpm:122,barCount:2,meter:{numerator:4,denominator:4},notes:[],tracks:[]};
it('shortens the ggsdg loop by 0.281 seconds without moving A or losing its identity',()=>{
 const resized=loopForScore(loop,score,100);
 expect(resized.start).toBe(loop.start);expect(resized.end).toBeCloseTo(5.78855323,7);
 expect(loop.end-resized.end).toBeCloseTo(.28084177,7);
 expect(resized.id).toBe(loop.id);expect(resized.materialId).toBe(loop.materialId);
 expect(resized.rhythm?.firstBeat).toBe(0);
});
it('can instead start at the previously identified beat and checks the recording boundary',()=>{
 const resized=loopForScore(loop,score,100,true);
 expect(resized.start).toBeCloseTo(2.0137641882,7);expect(resized.end).toBeCloseTo(5.9481904177,7);
 expect(()=>loopForScore(loop,score,5)).toThrow('Ende');
});
it('retains stem audio and trims notes when the range is shortened or its start moved',()=>{
 const result={version:2,start:1,end:7,stems:[{id:0,name:'Guitar',source:'guitar',path:'saved.wav',rms:.5,warning:null,notes:[{time:0,duration:2,midi:60,velocity:.8,track:0},{time:5,duration:1,midi:64,velocity:.8,track:0}]}]};
 const cropped=analysisForRange(result,2,4)!;
 expect(cropped.stems[0].path).toBe('saved.wav');expect(cropped.stems[0].audioOffset).toBe(1);
 expect(cropped.stems[0].notes).toHaveLength(1);expect(cropped.stems[0].notes[0]).toMatchObject({time:0,duration:1});
 expect(analysisForRange(result,2,8)).toBeNull();
});
