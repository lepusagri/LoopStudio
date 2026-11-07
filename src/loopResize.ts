import type {Loop} from './music';
import type {ScoreDocument} from './ScoreStudio';
import type {AnalysisResult} from './analysis';

/** Explicitly make the score authoritative for the loop's duration and musical structure. */
export function loopForScore(loop:Loop,score:ScoreDocument,mediaDuration:number,useFirstBeat=false):Loop{
 if(!Number.isFinite(score.duration)||score.duration<.1||!Number.isFinite(score.bpm)||score.bpm<20||score.bpm>400||!score.barCount||!score.meter)throw new Error('Die Partiturlänge oder die Taktangaben sind unvollständig.');
 const start=loop.start+(useFirstBeat?(loop.rhythm?.firstBeat??0):0),end=start+score.duration;
 if(!Number.isFinite(start)||start<0||!Number.isFinite(mediaDuration)||mediaDuration<=0||end>mediaDuration+.001)throw new Error('Die angepasste Passage würde über das Ende der Aufnahme hinausreichen.');
 return {...loop,start,end,rhythm:{bpm:score.bpm,beatsPerBar:score.meter.numerator,beatUnit:score.meter.denominator,bars:score.barCount,firstBeat:0}};
}

/** Reuse existing separated audio when the new loop is entirely inside the analyzed audio. */
export function analysisForRange(result:AnalysisResult|null,start:number,end:number):AnalysisResult|null{
 if(!result||start<result.start-.001||end>result.end+.001)return null;
 const delta=Math.max(0,start-result.start),duration=end-start;
 return {...result,start,end,edited:true,stems:result.stems.map(stem=>({...stem,audioOffset:(stem.audioOffset??0)+delta,notes:stem.notes.filter(n=>n.time+n.duration>delta&&n.time<delta+duration).map(n=>({...n,time:Math.max(0,n.time-delta),duration:Math.min(n.time+n.duration-delta,duration)-Math.max(0,n.time-delta)}))}))};
}
