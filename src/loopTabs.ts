import type {Loop} from './music';
import type {ScoreDocument} from './ScoreStudio';
import type {serializeScore} from './loopMaterials';
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
