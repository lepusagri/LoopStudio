import {expect,it} from 'vitest';
import {scoreTrackForStem,stemForScoreTrack} from './analysisTrack';
import type {ScoreDocument} from './ScoreStudio';
import type {AnalysisResult} from './analysis';
const result:AnalysisResult={version:2,start:1,end:5,stems:[{id:4,source:'guitar',name:'Gitarre',path:'guitar.wav',notes:[],rms:.1,warning:null}]};
const doc:ScoreDocument={id:'score',name:'Loop',duration:4,bpm:120,notes:[],tracks:[{id:0,name:'Bass',count:8},{id:1,name:'Gitarre',count:23}],origin:{kind:'analysis',start:1,end:5,trackIds:[1,4]}};
it('maps Demucs guitar ID 4 to GP track 1 instead of treating the stem ID as a score index',()=>{
 expect(scoreTrackForStem(doc,result,4)).toBe(1);
 expect(stemForScoreTrack(doc,result,1)).toBe(4);
 expect(scoreTrackForStem({...doc,tracks:[doc.tracks[0]],origin:{...doc.origin!,trackIds:[1]}},result,4)).toBeNull();
 expect(scoreTrackForStem(doc,{...result,end:6},4)).toBeNull();
});
it('does not replace an imported score view with unrelated raw stem IDs',()=>{
 expect(scoreTrackForStem({...doc,origin:{kind:'import'}},result,4)).toBe(1);
 expect(stemForScoreTrack({...doc,origin:{kind:'import'}},result,1)).toBe(4);
 expect(scoreTrackForStem({...doc,name:'Tabs · erkannte Tabs.gp',tracks:[{id:0,name:'Tab',count:8}],origin:{kind:'import'}},result,4)).toBe(0);
});
it('highlights the guitar mixer channel for an additional guitar voice in the score',()=>{
 expect(stemForScoreTrack({...doc,tracks:[...doc.tracks,{id:2,name:'Gitarre · Stimme 2',count:3}],origin:{...doc.origin!,trackIds:[1,4,4]}},result,2)).toBe(4);
});
