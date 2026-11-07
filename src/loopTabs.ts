import type {Loop} from './music';
import type {ScoreDocument} from './ScoreStudio';
import type {serializeScore} from './loopMaterials';
import {ensureGp7,updatedGp7} from './gp7Document';
import {exportGp7} from './gp7Export';
export type TabDraft={clips:{id:string;time:number;image:string}[];pdf?:string;warnings?:string[];candidate?:ReturnType<typeof serializeScore>;previousScore?:ReturnType<typeof serializeScore>};
export function loopScoreFit(doc:ScoreDocument,loop:Loop){
 const r=loop.rhythm;
 const problems:string[]=[];
 if(!r?.bars)problems.push('Taktzahl des Loops noch bestätigen.');
 if(!doc.barCount)problems.push('Taktzahl der Partitur ist unbekannt.');
 if(r?.bars&&doc.barCount&&r.bars!==doc.barCount)problems.push(`Loop: ${r.bars} Takte · Partitur: ${doc.barCount} Takte. Fehlende oder zusätzliche Takte prüfen.`);
 if(!doc.meter||r&& (r.beatsPerBar!==doc.meter.numerator||r.beatUnit!==doc.meter.denominator))problems.push('Taktart von Loop und Partitur stimmt noch nicht überein.');
 if(doc.variableTiming)problems.push('Partitur enthält Tempo- oder Taktartwechsel; Zuordnung manuell prüfen.');
 if(r?.firstBeat===undefined)problems.push('Ersten Taktbeginn im Loop bestätigen.');
 if((r?.firstBeat??0)>.05)problems.push('Loop enthält einen Vorlauf oder Auftakt; die passende Notenpassage manuell zuordnen.');
 if(!r?.bpm)problems.push('Tempo des Loops noch bestätigen.');
 return {canAlign:problems.length===0,problems,durationDifference:doc.duration-(loop.end-loop.start)};
}
export async function replaceScoreTrack(document:ScoreDocument,candidate:ScoreDocument,target:number):Promise<ScoreDocument>{
 const at=await import('@coderline/alphatab');
 const existing=await ensureGp7(document),incoming=await ensureGp7(candidate),settings=new at.Settings();
 if(existing.barCount!==incoming.barCount||existing.variableTiming||incoming.variableTiming||Math.abs(existing.duration-incoming.duration)>.15||existing.meter?.numerator!==incoming.meter?.numerator||existing.meter?.denominator!==incoming.meter?.denominator)throw new Error('Zum Ersetzen einer Spur müssen Taktumfang, Taktart und zeitlicher Verlauf beider Partituren übereinstimmen.');
 const score=at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(existing.gp!),settings),source=at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(incoming.gp!),settings);
 const old=score.tracks[target],replacement=source.tracks[0];
 if(!old||!replacement||source.tracks.length!==1)throw new Error('Bitte eine einzelne erkannte Spur und eine gültige Zielspur verwenden.');
 replacement.name=old.name;replacement.playbackInfo.primaryChannel=old.playbackInfo.primaryChannel;replacement.playbackInfo.secondaryChannel=old.playbackInfo.secondaryChannel;
 const tracks=score.tracks.map((track,i)=>i===target?replacement:track);score.tracks=[];for(const track of tracks)score.addTrack(track);
 let barId=0,voiceId=0,beatId=0,noteId=0;
 for(const track of score.tracks)for(const staff of track.staves)for(const bar of staff.bars){bar.id=barId++;for(const voice of bar.voices){voice.id=voiceId++;for(const beat of voice.beats){beat.id=beatId++;for(const note of beat.notes)note.id=noteId++;}}}
 score.finish(settings);
 return updatedGp7(existing,exportGp7(score,settings).slice().buffer);
}
