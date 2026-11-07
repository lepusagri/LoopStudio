import { exportGp7 } from './gp7Export';
import type { ScoreDocument, ScorePlaybackState } from './ScoreStudio';
import type { Note } from './music';
import { parseGuitarPro } from './guitarPro';
import { notationTex } from './notationData';
import { assignFingerings } from './fingering';

export type ScoreOrigin = { kind: 'analysis' | 'import'; start?: number; end?: number; trackIds?: number[] };
export type ScoreSource = Pick<ScoreDocument,'notes'|'tracks'|'duration'|'bpm'>;
export async function updatedGp7(document: ScoreDocument, bytes: ArrayBuffer): Promise<ScoreDocument> {
  if(bytes.byteLength>20*1024*1024)throw new Error('Die Partitur überschreitet 20 MB.');
  const parsed=await parseGuitarPro(bytes, { allowEmpty: true });
  return {...document,...parsed,gp:bytes,gpFormat:'gp7',edited:false,name:document.name.replace(/\.(gp[3-8]?|gpx|mid|midi)$/i,'')+'.gp'};
}

/** Only this boundary creates GP7 from legacy event lists. Later edits always operate on the Score. */
export async function ensureGp7(document:ScoreDocument):Promise<ScoreDocument> {
  const at=await import('@coderline/alphatab');
  const settings=new at.Settings();
  // Fold old generated voice-tracks back into their original instrument, retaining edits.
  if(document.gp&&!document.edited&&document.origin?.kind==='analysis'&&document.source&&document.tracks.some(t=>/ · (Stimme \d+|weitere Noten)$/.test(t.name))){
    const trackIds=document.origin.trackIds;
    if(trackIds){
      let nextId=Math.max(-1,...trackIds,...document.source.tracks.map(t=>t.id))+1;
      const mapping=new Map(document.tracks.map(t=>[t.id,trackIds[t.id]??nextId++]));
      const tracks=[...new Map(document.tracks.map(t=>[mapping.get(t.id)!,{...t,id:mapping.get(t.id)!,name:t.name.replace(/ · (Stimme \d+|weitere Noten)$/,'')}])).values()];
      return ensureGp7({...document,gp:undefined,tracks,notes:document.notes.map(n=>{
        const name=document.tracks.find(t=>t.id===n.track)?.name??'',voice=Number(name.match(/ · Stimme (\d+)$/)?.[1]);
        return {...n,track:mapping.get(n.track)??n.track,position:voice?voice<=2&&n.position?{...n.position,voice}:undefined:n.position};
      })});
    }
  }
  if(document.gp&&!document.edited){
    if(document.gpFormat==='gp7')return updatedGp7(document,document.gp);
    const score=at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(document.gp),settings);
    return updatedGp7(document,exportGp7(score,settings).slice().buffer);
  }
  const bpm=Number.isFinite(document.bpm)&&document.bpm>0?document.bpm:120;
  const duration=Math.max(document.duration,...document.notes.map(n=>n.time+n.duration),.125);
  if(!Number.isFinite(duration)||duration/(60/bpm/4)>4096)throw new Error('Für die Umwandlung bitte eine Passage mit höchstens 256 Takten verwenden.');
  const score=new at.model.Score();score.title=document.name;
  const ids:number[]=[],warnings:string[]=[];
  for(const track of document.tracks){
    let notes=document.notes.filter(n=>n.track===track.id);
    if(!notes.length)continue;
    if(notes.some(n=>!n.position)&&/guitar|gitarre/i.test(track.name)){
      try{notes=(await assignFingerings(notes)).notes;}catch{warnings.push(`${track.name}: Griffzuordnung nicht verfügbar; Tonhöhen bleiben als Noten erhalten.`);}
    }
    const groups=new Map<string,Note[]>();
    for(const original of notes){
      const note=original.position&&original.position.voice>2?{...original,position:undefined}:original;
      const p=note.position,key=p?JSON.stringify([p.voice,p.tuning,p.capo]):'pitched';
      groups.set(key,[...(groups.get(key)??[]),note]);
    }
    const target=new at.model.Track();target.name=track.name;
    const ordered=[...groups].sort((a,b)=>(a[1][0].position?.voice??3)-(b[1][0].position?.voice??3));
    target.playbackInfo.program=/guitar|gitarre/i.test(track.name)?25:0;
    const channel=score.tracks.length%15;target.playbackInfo.primaryChannel=channel>=9?channel+1:channel;target.playbackInfo.secondaryChannel=target.playbackInfo.primaryChannel;
    for(const [group,values] of ordered){
      const parser=new at.importer.AlphaTexImporter();
      parser.initFromString((group==='pitched'?'\\instrument 0 ':'')+notationTex(values,bpm,duration,group!=='pitched',document.meter),settings);
      const part=parser.readScore(),t=part.tracks[0];
      if(!score.masterBars.length)for(const bar of part.masterBars)score.addMasterBar(bar);
      if(group==='pitched')for(const staff of t.staves){staff.stringTuning.tunings=[];staff.showTablature=false;staff.transpositionPitch=0;staff.displayTranspositionPitch=0;}
      for(const staff of [...t.staves])target.addStaff(staff);
    }
    score.addTrack(target);ids.push(track.id);
  }
  if(!score.tracks.length)throw new Error('Für diese Passage sind noch keine Noten vorhanden.');
  let barId=0,voiceId=0,beatId=0,noteId=0;
  for(const track of score.tracks)for(const staff of track.staves)for(const bar of staff.bars){bar.id=barId++;for(const voice of bar.voices){voice.id=voiceId++;for(const beat of voice.beats){beat.id=beatId++;for(const note of beat.notes)note.id=noteId++;}}}
  score.finish(settings);
  const bytes=exportGp7(score,settings).slice().buffer;
  return updatedGp7({...document,source:document.source??{notes:document.notes,tracks:document.tracks,duration:document.duration,bpm:document.bpm},origin:{...document.origin,kind:document.origin?.kind??'import',trackIds:ids},conversionNote:`Aus Zeitdaten auf ein 1/16-Raster bei ${bpm} BPM übertragen. Original-Zeitdaten bleiben erhalten.${warnings.length?' '+warnings.join(' '):''}`},bytes);
}

/** Note edits retain media A/B. Timing edits require the user to establish a new alignment. */
export function reconcileScoreState(before:ScoreDocument,after:ScoreDocument,state:ScorePlaybackState|null):ScorePlaybackState|null {
  if(!state)return null;
  const timingChanged=Math.abs(before.duration-after.duration)>.001||before.bpm!==after.bpm||before.notes.length!==after.notes.length||before.notes.some((n,i)=>Math.abs(n.time-after.notes[i].time)>.001||Math.abs(n.duration-after.notes[i].duration)>.001);
  return {...state,track:after.tracks.some(t=>t.id===state.track)?state.track:after.tracks[0]?.id??-1,start:Math.min(state.start,after.duration),end:Math.min(state.end,after.duration),alignment:timingChanged?null:state.alignment};
}
