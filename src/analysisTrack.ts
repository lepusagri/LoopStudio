import type {AnalysisResult} from './analysis';
import type {ScoreDocument} from './ScoreStudio';
import {samePassage} from './loopMaterials';
/** Stem IDs belong to Demucs; GP track IDs can be renumbered or split into voices. */
export function scoreTrackForStem(doc:ScoreDocument,result:AnalysisResult,id:number):number|null{
 const stem=result.stems.find(s=>s.id===id);if(!stem)return null;
 if(doc.origin?.kind==='analysis'){
  if(!samePassage(result.start,result.end,doc.origin.start??-1,doc.origin.end??-1))return null;
  const mapped=doc.origin.trackIds?.indexOf(id);
  if(mapped!==undefined)return mapped>=0&&doc.tracks.some(t=>t.id===mapped)?mapped:null;
  return doc.tracks.find(t=>t.id===id)?.id??null;
 }
 const named=doc.tracks.find(t=>t.name.toLocaleLowerCase().includes(stem.name.toLocaleLowerCase()));
 if(named)return named.id;
 if(stem.source==='guitar'&&doc.tracks.length===1&&doc.name.includes('erkannte Tabs'))return doc.tracks[0].id;
 return null;
}
export function stemForScoreTrack(doc:ScoreDocument,result:AnalysisResult,track:number):number|null{
 if(track<0||!doc.tracks.some(t=>t.id===track))return null;
 if(doc.origin?.kind==='analysis'&&doc.origin.trackIds){
  if(!samePassage(result.start,result.end,doc.origin.start??-1,doc.origin.end??-1))return null;
  const id=doc.origin.trackIds[track];
  return result.stems.some(stem=>stem.id===id)?id:null;
 }
 return result.stems.find(stem=>scoreTrackForStem(doc,result,stem.id)===track)?.id??null;
}
