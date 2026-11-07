import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Loop, LoopRhythm } from './music';
import type { ScoreDocument } from './ScoreStudio';
type Proposal={bpm:number;firstBeat:number;confidence:number;beats:number[]};
export function LoopRhythmPanel({loop,source,blob,document:doc,onChange}:{loop:Loop;source?:string;blob?:Blob;document:ScoreDocument|null;onChange:(rhythm:LoopRhythm)=>void}){
 const rhythm=loop.rhythm??{bpm:null,beatsPerBar:4,beatUnit:4,bars:null};
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[proposal,setProposal]=useState<Proposal|null>(null),[preview,setPreview]=useState(false);
 const revision=useRef(0),audio=useRef<AudioContext|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const duration=loop.end-loop.start;
 function stop(){if(timer.current)clearTimeout(timer.current);timer.current=null;void audio.current?.close();audio.current=null;setPreview(false);}
 useEffect(()=>()=>{revision.current++;if(timer.current)clearTimeout(timer.current);void audio.current?.close();},[]);
 function change(values:Partial<LoopRhythm>){stop();onChange({...rhythm,...values});}
 async function analyze(){const token=++revision.current;setBusy(true);setError('');stop();try{
  const path=source??(blob?await invoke<string>('stage_media',await blob.arrayBuffer()):null);
  if(!path)throw new Error('Die lokale Aufnahme fehlt.');
  const result=await invoke<Proposal>('analyze_loop_rhythm',{source:path,start:loop.start,end:loop.end});
  if(token===revision.current)setProposal(result);
 }catch(e){if(token===revision.current)setError(String(e));}finally{if(token===revision.current)setBusy(false);}}
 async function clickTrack(){if(preview){stop();return;}const bpm=proposal?.bpm??rhythm.bpm;if(!bpm)return;
  try{const ctx=new AudioContext();audio.current=ctx;await ctx.resume();const first=proposal?.firstBeat??rhythm.firstBeat??0;const interval=60/bpm;
   for(let t=first;t<Math.min(duration,20);t+=interval){const osc=ctx.createOscillator(),gain=ctx.createGain();osc.frequency.value=1000;gain.gain.setValueAtTime(.12,ctx.currentTime+t);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+t+.04);osc.connect(gain);gain.connect(ctx.destination);osc.start(ctx.currentTime+t);osc.stop(ctx.currentTime+t+.05);}
   setPreview(true);timer.current=setTimeout(stop,Math.min(duration,20)*1000+100);
  }catch{setError('Metronom konnte nicht gestartet werden.');stop();}}
 const count=rhythm.bpm?duration*rhythm.bpm*rhythm.beatUnit/(240*rhythm.beatsPerBar):null;
 const expected=rhythm.bpm&&rhythm.bars?rhythm.bars*rhythm.beatsPerBar*4/rhythm.beatUnit*60/rhythm.bpm:null;
 return <section className="instrument-card"><div className="instrument-toolbar"><strong>Loop · {loop.name}</strong><span>{duration.toFixed(2)} s</span><button className="button subtle" disabled={busy||duration<4||duration>180} onClick={()=>void analyze()}>{busy?'Rhythmus wird geschätzt …':'Rhythmus schätzen'}</button></div>
 <div className="score-controls"><label>BPM <input aria-label="Loop BPM" type="number" min="20" max="400" step=".1" value={rhythm.bpm??''} onChange={e=>{const n=+e.target.value;if(!e.target.value||n>=20&&n<=400)change({bpm:e.target.value?n:null});}}/></label><label>Taktart <select value={rhythm.beatsPerBar} onChange={e=>change({beatsPerBar:+e.target.value})}>{[2,3,4,5,6,7,8,9,12].map(n=><option key={n}>{n}</option>)}</select> / <select value={rhythm.beatUnit} onChange={e=>change({beatUnit:+e.target.value})}>{[2,4,8,16].map(n=><option key={n}>{n}</option>)}</select></label><label>Takte <input aria-label="Takte im Loop" type="number" min="1" max="512" value={rhythm.bars??''} onChange={e=>{const n=+e.target.value;if(!e.target.value||Number.isInteger(n)&&n>=1&&n<=512)change({bars:e.target.value?n:null});}}/></label><label>Erster Taktbeginn nach A <input type="number" min="0" max={duration} step=".01" value={rhythm.firstBeat??0} onChange={e=>{const n=+e.target.value;if(n>=0&&n<duration)change({firstBeat:n});}}/> s</label></div>
 {proposal&&<div className="score-controls"><span>Vorschlag: {proposal.bpm.toFixed(1)} BPM · {proposal.confidence>.45?'regelmäßiger Puls':'unsicher, bitte prüfen'}</span><button className="button subtle" disabled={proposal.bpm<40} onClick={()=>setProposal({...proposal,bpm:proposal.bpm/2})}>½ Tempo</button><button className="button subtle" disabled={proposal.bpm>200} onClick={()=>setProposal({...proposal,bpm:proposal.bpm*2})}>Doppeltes Tempo</button><button className="button light" onClick={()=>{change({bpm:Math.round(proposal.bpm*10)/10,firstBeat:proposal.firstBeat,confidence:proposal.confidence});setProposal(null);}}>Tempo und Start übernehmen</button></div>}
 {(proposal||rhythm.bpm)&&<div className="score-controls"><button className="button subtle" onClick={()=>void clickTrack()}>{preview?'Metronom stoppen':'Metronom prüfen (max. 20 s)'}</button><span>{count!==null?`Loopdauer entspricht etwa ${count.toFixed(2)} Takten bei konstantem Tempo.`:''}</span>{count!==null&&Math.round(count)>=1&&Math.round(count)<=512&&Math.abs(count-Math.round(count))<.15&&<button className="button subtle" onClick={()=>change({bars:Math.round(count)})}>{Math.round(count)} ganze Takte übernehmen</button>}</div>}
 {expected!==null&&Math.abs(expected-duration)>.15&&<p className="analysis-hint score-description">Taktumfang und Loopdauer weichen um {(expected-duration).toFixed(2)} s voneinander ab. Taktbeginn, Auftakt und A/B prüfen.</p>}
 {doc&&<p className="analysis-hint score-description">Partitur: {doc.bpm.toFixed(1)} BPM · {doc.duration.toFixed(2)} s. {Math.abs(doc.duration-duration)>.15?'Die Dauer weicht vom Loop ab; Zuordnung im Notenplayer prüfen.':'Die Dauer passt zum Loop.'}</p>}
 <p className="analysis-hint score-description">Lokale Rhythmusschätzung. Taktart und ersten Taktbeginn beim Anhören prüfen; halbes oder doppeltes Tempo kann ebenfalls passen.</p>
 {error&&<p className="analysis-error" role="alert">{error}</p>}</section>;
}
