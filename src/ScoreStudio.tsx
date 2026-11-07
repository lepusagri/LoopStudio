import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { FretworkEditor } from './FretworkEditor';
import { ExternalScoreEditor } from './ExternalScoreEditor';
import { reconcileScoreState, type ScoreOrigin, type ScoreSource } from './gp7Document';
import { Notation } from './Notation';
import { Fretboard, Waterfall } from './Instrument';
import { formatTime, isActive, noteName, type Note, type NoteTrack } from './music';
import { mappedTime, validAlignment, alignmentForPractice, type Alignment } from './scoreTransport';

export type ScorePlaybackState = { track:number; start:number; end:number; speed:number; loop:boolean; alignment:Alignment|null };
export type ScoreDocument = { externalEdit?: import('./externalScore').ExternalEdit; id: string; name: string; notes: Note[]; tracks: NoteTrack[]; duration: number; bpm: number; meter?: {numerator:number;denominator:number}; barCount?:number; variableTiming?:boolean; edited?: boolean; gp?: ArrayBuffer; midi?: ArrayBuffer; gpFormat?: 'gp7'; source?: ScoreSource; origin?: ScoreOrigin; conversionNote?: string };
export function ScoreStudio({ document: doc, media, mediaKey, a, b, onLoad, initialState, onStateChange, onChange, active=true, editRequest=0, loadLabel='MIDI / Guitar Pro laden', initialView='notation', onViewChange, selectedTrack, onTrackChange, compact=false, onCompactChange, projectPath, externalContext }: { projectPath?:string; externalContext?:string; compact?:boolean; onCompactChange?:(compact:boolean)=>void; loadLabel?:string; editRequest?:number; active?:boolean; onChange:(document:ScoreDocument)=>Promise<void>|void; initialState?:ScorePlaybackState|null; onStateChange?:(state:ScorePlaybackState)=>void; document: ScoreDocument; media: RefObject<HTMLVideoElement | null>; mediaKey: string; a: number | null; b: number | null; onLoad: () => void; initialView?:'notation'|'guitar'|'piano'; onViewChange?:(view:'notation'|'guitar'|'piano')=>void; selectedTrack?:number; onTrackChange?:(track:number)=>void }) {
  const [track, setTrack] = useState(initialState?.track ?? doc.tracks[0]?.id ?? -1), [time, setTime] = useState(initialState?.start ?? 0), [playing, setPlaying] = useState(false);
  useEffect(()=>{if(selectedTrack!==undefined&&(selectedTrack===-1||doc.tracks.some(t=>t.id===selectedTrack))&&selectedTrack!==track)setTrack(selectedTrack);},[selectedTrack,doc.tracks,track]);
  const [speed, setSpeed] = useState(initialState?.speed ?? 1), [volume, setVolume] = useState(.3), [view, setView] = useState(initialView), [leftHanded,setLeftHanded]=useState(false);
  const [start, setStart] = useState(initialState?.start ?? 0), [end, setEnd] = useState(initialState?.end ?? doc.duration), [loop, setLoop] = useState(initialState?.loop ?? false);
  const [alignment, setAlignment] = useState<Alignment | null>(initialState?.alignment ?? null), [linked, setLinked] = useState(!!initialState?.alignment && doc.origin?.kind==='analysis'), [error, setError] = useState('');
  const [editorOpen,setEditorOpen]=useState(false);
  const [externalBusy,setExternalBusy]=useState(false);
  const lastEditRequest=useRef(editRequest);
  useEffect(()=>{if(editRequest!==lastEditRequest.current){lastEditRequest.current=editRequest;if(externalBusy)return;setPlaying(false);setLinked(false);media.current?.pause();setEditorOpen(true);}},[editRequest]);
  const previousDocument=useRef(doc);
  useEffect(()=>{if(previousDocument.current!==doc){const next=reconcileScoreState(previousDocument.current,doc,{track,start,end,speed,loop,alignment})!;previousDocument.current=doc;setPlaying(false);setLinked(false);setTrack(next.track);setStart(next.start);setEnd(next.end);setAlignment(next.alignment);clock.current=Math.min(clock.current,doc.duration);}},[doc]);
  const clock = useRef(initialState?.start ?? 0), context = useRef<AudioContext | null>(null);
  const notes = useMemo(() => track < 0 ? doc.notes : doc.notes.filter(n => n.track === track), [doc, track]);
  const activeNotes = [...new Set(notes.filter(note=>isActive(note,time)).map(note=>note.midi))];
  const practiceAlignment=alignmentForPractice(alignment,a,b);
  const controls = useRef({compact,practiceAlignment, playing, speed, volume, start, end, loop, linked, alignment, notes });
  controls.current = {compact,practiceAlignment, playing, speed, volume, start, end, loop, linked, alignment, notes };
  const previousMedia = useRef(mediaKey);
  useEffect(() => { if(previousMedia.current!==mediaKey){setLinked(false);setAlignment(null);previousMedia.current=mediaKey;} }, [mediaKey]);
  useEffect(()=>{onStateChange?.({track,start,end,speed,loop,alignment});},[track,start,end,speed,loop,alignment,onStateChange]);
  useEffect(() => {
    let frame = 0, previous = performance.now(), lastTime = -1;
    const voices = new Map<Note, { oscillator: OscillatorNode; gain: GainNode }>();
    const silence = () => { voices.forEach(v => { v.oscillator.stop(); v.oscillator.disconnect(); v.gain.disconnect(); }); voices.clear(); };
    const tick = (stamp: number) => {
      const c = controls.current, elapsed = Math.min(.1, (stamp - previous) / 1000); previous = stamp;
      let running = c.playing;
      const follow=c.compact?c.practiceAlignment:c.linked?c.alignment:null;
      if (follow && media.current) {
        const video = media.current, m = follow;
        const inside = video.currentTime >= m.mediaStart && video.currentTime < m.mediaEnd;
        clock.current = Math.max(0, Math.min(doc.duration, mappedTime(video.currentTime, m)));
        running = inside && !video.paused && !video.seeking;
      } else if (running) {
        clock.current += elapsed * c.speed;
        if (c.loop && c.end > c.start && (clock.current >= c.end || clock.current < c.start)) clock.current = c.start;
        if (clock.current >= doc.duration) { clock.current = doc.duration; setPlaying(false); running = false; }
      }
      if (!running || Math.abs(clock.current - lastTime) > .25) silence();
      const active = running && !c.compact ? c.notes.filter(n => n.time <= clock.current && clock.current < n.time + n.duration) : [];
      for (const [n, voice] of voices) if (!active.includes(n)) { voice.oscillator.stop(); voice.oscillator.disconnect(); voice.gain.disconnect(); voices.delete(n); }
      const ctx = context.current;
      if (ctx?.state === 'running') {
        for (const n of active.slice(0, 64)) if (!voices.has(n)) {
          const oscillator = ctx.createOscillator(), gain = ctx.createGain();
          oscillator.type = 'triangle'; oscillator.frequency.value = 440 * 2 ** ((n.midi - 69) / 12);
          gain.gain.value = 0; oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start();
          voices.set(n, { oscillator, gain });
        }
        for (const [n, voice] of voices) voice.gain.gain.setTargetAtTime(n.velocity * c.volume * .15 / Math.sqrt(Math.max(1, voices.size)), ctx.currentTime, .01);
      }
      lastTime = clock.current; setTime(clock.current); frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); silence(); void context.current?.close(); context.current = null; };
  }, [doc.id, doc.duration, media]);
  async function enableAudio() { if (!context.current) context.current = new AudioContext(); await context.current.resume(); }
  async function toggle() { try { await enableAudio(); if (clock.current >= doc.duration) clock.current = loop ? start : 0; setLinked(false); setPlaying(!playing); } catch { setError('Notenwiedergabe konnte nicht gestartet werden.'); } }
  useEffect(()=>{if(!active){setPlaying(false);setLinked(false);}},[active]);
  useEffect(()=>{if(compact){setPlaying(false);if(track<0&&doc.tracks.length){setTrack(doc.tracks[0].id);onTrackChange?.(doc.tracks[0].id);}}},[compact]);
  const candidate = { scoreStart: start, scoreEnd: end, mediaStart: a ?? -1, mediaEnd: b ?? -1 };
  return <section className={`score-studio instrument-card ${compact?'score-practice':''}`} aria-label="Loop-Partitur">
    {compact?<div className="practice-score-bar"><span>{doc.tracks.find(t=>t.id===track)?.name??doc.name} · folgt dem Video</span><button className="button subtle small" onClick={()=>onCompactChange?.(false)}>Vorbereiten</button></div>:<>
    <div className="instrument-toolbar"><div><strong>NOTENPLAYER</strong><p>{doc.name}</p></div><div className="practice-actions">{onCompactChange&&<button className="button light" disabled={!practiceAlignment} title={!practiceAlignment?'Zuerst die Notenpassage mit dem aktuellen Loop verknüpfen.':'Nur die synchronisierte Notenansicht zeigen'} onClick={()=>onCompactChange(true)}>Übungsansicht</button>}<button className="button subtle" disabled={externalBusy} onClick={onLoad}>{loadLabel}</button></div></div>
    <div className="score-controls"><button className="button light" onClick={() => void toggle()}>{playing && !linked ? 'Noten pausieren' : 'Noten abspielen'}</button><button className="button subtle" onClick={() => {setPlaying(false);setLinked(false);clock.current=0;}}>Stopp</button><span>{formatTime(time)} / {formatTime(doc.duration)}</span>
      <label>Notenspur <select value={track} onChange={e => {const next=+e.target.value;setTrack(next);onTrackChange?.(next);}}><option value={-1}>Alle Spuren</option>{doc.tracks.map(t => <option value={t.id} key={t.id}>{t.name} · {t.count} Noten</option>)}</select></label>
      <label>Tempo <select disabled={linked} value={speed} onChange={e=>setSpeed(+e.target.value)}>{[.25,.5,.75,1,1.25,1.5,2].map(v=><option key={v} value={v}>{v*100} %</option>)}</select></label>
      <label>Notenlautstärke <input aria-label="Notenlautstärke" type="range" min="0" max="1" step=".01" value={volume} onChange={e=>setVolume(+e.target.value)}/></label></div>
    <input className="score-seek" aria-label="Position in Notendatei" disabled={linked} type="range" min="0" max={doc.duration} step=".01" value={time} onChange={e=>{clock.current=+e.target.value;setTime(clock.current);}}/>
    <div className="score-controls"><label>Notenpassage von <input aria-label="Notenpassage Anfang" type="number" min="0" max={doc.duration} step=".1" value={start} onChange={e=>setStart(+e.target.value)}/> s</label><button className="button subtle small" onClick={()=>setStart(time)}>Hier starten</button><label>bis <input aria-label="Notenpassage Ende" type="number" min="0" max={doc.duration} step=".1" value={end} onChange={e=>setEnd(+e.target.value)}/> s</label><button className="button subtle small" onClick={()=>setEnd(time)}>Hier enden</button><label><input type="checkbox" checked={loop} disabled={end<=start} onChange={e=>setLoop(e.target.checked)}/> Noten loopen</label></div>
    <div className="score-controls"><button className="button subtle" disabled={!validAlignment(candidate) || end > doc.duration} onClick={()=>{setAlignment(candidate);setLinked(false);}}>Notenpassage mit Aufnahme A/B verknüpfen</button><button className="button subtle" disabled={!alignment} onClick={async()=>{try {await enableAudio();setPlaying(false);setLinked(!linked);}catch {setError('Audio konnte nicht aktiviert werden.');}}}>{linked?'Synchronisation lösen':'Aufnahme folgen'}</button><span>{alignment ? `${formatTime(alignment.scoreStart)}–${formatTime(alignment.scoreEnd)} Noten ↔ ${formatTime(alignment.mediaStart)}–${formatTime(alignment.mediaEnd)} Aufnahme` : 'In beiden Playern eine Passage auswählen.'}</span></div>
    <p className="analysis-hint score-description">{linked ? 'Die Aufnahme steuert Position und Tempo der Noten. Wiedergabe oben starten. Außerhalb der verknüpften Passage bleibt der Notenklang stumm.' : 'Eigene Wiedergabe mit einfachem Syntheseklang. Die gewählte Spur steuert Klang und Anzeige.'}</p>
    <div className="tabs score-controls">{[['notation','Noten & Tabulatur'],['guitar','Griffbrett'],['piano','Piano Waterfall'],['edit','Noten bearbeiten']].map(([id,name])=><button disabled={externalBusy} className={view===id?'active':''} key={id} onClick={()=>{if(id==='edit'){setPlaying(false);setLinked(false);media.current?.pause();setEditorOpen(true);}else{const next=id as 'notation'|'guitar'|'piano';setView(next);onViewChange?.(next);}}}>{name}</button>)}{view==='guitar'&&<label className="checkbox"><input type="checkbox" checked={leftHanded} onChange={e=>setLeftHanded(e.target.checked)}/> Linkshändig</label>}</div>
    <ExternalScoreEditor document={doc} project={projectPath} context={externalContext??doc.id} active={active} disabled={editorOpen} onBusyChange={setExternalBusy} onPause={()=>{setPlaying(false);setLinked(false);media.current?.pause();}} onChange={onChange}/>
    </>}
    {error && <p role="alert">{error}</p>}
    {(compact||view==='notation')&&<Notation compact={compact} doc={doc} track={track} notes={notes} time={time}/>}
    {!compact&&(view==='guitar'?<Fretboard notes={notes} time={time} leftHanded={leftHanded} originalPositions={!!doc.gp}/>:view==='piano'?<Waterfall notes={notes} time={time} playing={playing || linked}/>:null)}
    {!compact&&<div className="note-status"><span>JETZT</span><div className="note-chips">{activeNotes.length?activeNotes.map(midi=><span key={midi}>{noteName(midi,true)}</span>):<small>—</small>}</div><span className="note-source">{doc.name}</span></div>}
    {!compact&&doc.conversionNote&&<p className="analysis-hint score-description">{doc.conversionNote}</p>}
    {editorOpen&&<FretworkEditor document={doc} track={track} onSave={onChange} onClose={()=>setEditorOpen(false)}/>}

  </section>;
}
