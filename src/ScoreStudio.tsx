import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { AlphaTabApi } from '@coderline/alphatab';
import { Fretboard, Waterfall } from './Instrument';
import { formatTime, type Note, type NoteTrack } from './music';
import { mappedTime, validAlignment, type Alignment } from './scoreTransport';

export type ScoreDocument = { id: string; name: string; notes: Note[]; tracks: NoteTrack[]; duration: number; bpm: number; gp?: ArrayBuffer };
export function ScoreStudio({ document: doc, media, mediaKey, a, b, onLoad }: { document: ScoreDocument; media: RefObject<HTMLVideoElement | null>; mediaKey: string; a: number | null; b: number | null; onLoad: () => void }) {
  const [track, setTrack] = useState(doc.tracks[0]?.id ?? -1), [time, setTime] = useState(0), [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1), [volume, setVolume] = useState(.3), [view, setView] = useState('notation');
  const [start, setStart] = useState(0), [end, setEnd] = useState(doc.duration), [loop, setLoop] = useState(false);
  const [alignment, setAlignment] = useState<Alignment | null>(null), [linked, setLinked] = useState(false), [error, setError] = useState('');
  const clock = useRef(0), context = useRef<AudioContext | null>(null);
  const notes = useMemo(() => track < 0 ? doc.notes : doc.notes.filter(n => n.track === track), [doc, track]);
  const controls = useRef({ playing, speed, volume, start, end, loop, linked, alignment, notes });
  controls.current = { playing, speed, volume, start, end, loop, linked, alignment, notes };
  useEffect(() => { setLinked(false); setAlignment(null); }, [mediaKey]);
  useEffect(() => {
    let frame = 0, previous = performance.now(), lastTime = -1;
    const voices = new Map<Note, { oscillator: OscillatorNode; gain: GainNode }>();
    const silence = () => { voices.forEach(v => { v.oscillator.stop(); v.oscillator.disconnect(); v.gain.disconnect(); }); voices.clear(); };
    const tick = (stamp: number) => {
      const c = controls.current, elapsed = Math.min(.1, (stamp - previous) / 1000); previous = stamp;
      let running = c.playing;
      if (c.linked && c.alignment && media.current) {
        const video = media.current, m = c.alignment;
        const inside = video.currentTime >= m.mediaStart && video.currentTime < m.mediaEnd;
        clock.current = Math.max(0, Math.min(doc.duration, mappedTime(video.currentTime, m)));
        running = inside && !video.paused && !video.seeking;
      } else if (running) {
        clock.current += elapsed * c.speed;
        if (c.loop && c.end > c.start && (clock.current >= c.end || clock.current < c.start)) clock.current = c.start;
        if (clock.current >= doc.duration) { clock.current = doc.duration; setPlaying(false); running = false; }
      }
      if (!running || Math.abs(clock.current - lastTime) > .25) silence();
      const active = running ? c.notes.filter(n => n.time <= clock.current && clock.current < n.time + n.duration) : [];
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
  }, [doc, media]);
  async function enableAudio() { if (!context.current) context.current = new AudioContext(); await context.current.resume(); }
  async function toggle() { try { await enableAudio(); if (clock.current >= doc.duration) clock.current = loop ? start : 0; setLinked(false); setPlaying(!playing); } catch { setError('Notenwiedergabe konnte nicht gestartet werden.'); } }
  const candidate = { scoreStart: start, scoreEnd: end, mediaStart: a ?? -1, mediaEnd: b ?? -1 };
  return <section className="score-studio instrument-card">
    <div className="instrument-toolbar"><div><strong>NOTENPLAYER</strong><p>{doc.name}</p></div><button className="button subtle" onClick={onLoad}>MIDI / Guitar Pro laden</button></div>
    <div className="score-controls"><button className="button light" onClick={() => void toggle()}>{playing && !linked ? 'Noten pausieren' : 'Noten abspielen'}</button><button className="button subtle" onClick={() => {setPlaying(false);setLinked(false);clock.current=0;}}>Stopp</button><span>{formatTime(time)} / {formatTime(doc.duration)}</span>
      <label>Notenspur <select value={track} onChange={e => setTrack(+e.target.value)}><option value={-1}>Alle Spuren</option>{doc.tracks.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label>
      <label>Tempo <select disabled={linked} value={speed} onChange={e=>setSpeed(+e.target.value)}>{[.25,.5,.75,1,1.25,1.5,2].map(v=><option key={v} value={v}>{v*100} %</option>)}</select></label>
      <label>Notenlautstärke <input aria-label="Notenlautstärke" type="range" min="0" max="1" step=".01" value={volume} onChange={e=>setVolume(+e.target.value)}/></label></div>
    <input className="score-seek" aria-label="Position in Notendatei" disabled={linked} type="range" min="0" max={doc.duration} step=".01" value={time} onChange={e=>{clock.current=+e.target.value;setTime(clock.current);}}/>
    <div className="score-controls"><label>Notenpassage von <input aria-label="Notenpassage Anfang" type="number" min="0" max={doc.duration} step=".1" value={start} onChange={e=>setStart(+e.target.value)}/> s</label><button className="button subtle small" onClick={()=>setStart(time)}>Hier starten</button><label>bis <input aria-label="Notenpassage Ende" type="number" min="0" max={doc.duration} step=".1" value={end} onChange={e=>setEnd(+e.target.value)}/> s</label><button className="button subtle small" onClick={()=>setEnd(time)}>Hier enden</button><label><input type="checkbox" checked={loop} disabled={end<=start} onChange={e=>setLoop(e.target.checked)}/> Noten loopen</label></div>
    <div className="score-controls"><button className="button subtle" disabled={!validAlignment(candidate) || end > doc.duration} onClick={()=>{setAlignment(candidate);setLinked(false);}}>Notenpassage mit Aufnahme A/B verknüpfen</button><button className="button subtle" disabled={!alignment} onClick={async()=>{try {await enableAudio();setPlaying(false);setLinked(!linked);}catch {setError('Audio konnte nicht aktiviert werden.');}}}>{linked?'Synchronisation lösen':'Aufnahme folgen'}</button><span>{alignment ? `${formatTime(alignment.scoreStart)}–${formatTime(alignment.scoreEnd)} Noten ↔ ${formatTime(alignment.mediaStart)}–${formatTime(alignment.mediaEnd)} Aufnahme` : 'In beiden Playern eine Passage auswählen.'}</span></div>
    <p className="analysis-hint score-description">{linked ? 'Die Aufnahme steuert Position und Tempo der Noten. Wiedergabe oben starten. Außerhalb der verknüpften Passage bleibt der Notenklang stumm.' : 'Eigene Wiedergabe mit einfachem Syntheseklang. Die gewählte Spur steuert Klang und Anzeige.'}</p>
    <div className="tabs score-controls">{[['notation','Noten & Tabulatur'],['guitar','Griffbrett'],['piano','Piano Waterfall']].map(([id,name])=><button className={view===id?'active':''} key={id} onClick={()=>setView(id)}>{name}</button>)}</div>
    {error && <p role="alert">{error}</p>}
    {view==='notation'?<Notation doc={doc} track={track} notes={notes}/>:view==='guitar'?<Fretboard notes={notes} time={time} leftHanded={false} originalPositions={!!doc.gp}/>:<Waterfall notes={notes} time={time} playing={playing || linked}/>}
  </section>;
}

function Notation({doc,track,notes}:{doc:ScoreDocument;track:number;notes:Note[]}) {
  const host=useRef<HTMLDivElement>(null), api=useRef<AlphaTabApi|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let disposed=false;setError('');
    void import('@coderline/alphatab').then(at=>{
      if(disposed||!host.current)return;
      const instance=new at.AlphaTabApi(host.current,{core:{useWorkers:false,fontDirectory:'/fonts/'},player:{enablePlayer:false},display:{staveProfile:at.StaveProfile.ScoreTab}});
      api.current=instance;instance.error.on(e=>setError(String(e)));
      if(doc.gp) instance.load(new Uint8Array(doc.gp),track<0?undefined:[track]);
      else {
        // MIDI does not contain engraving or string positions. Display a quantized pitch score.
        const names=['c','c#','d','d#','e','f','f#','g','g#','a','a#','b'];
        const beat=60/(doc.bpm||120), step=beat/4;
        const cells=Array.from({length:Math.min(4096,Math.ceil(doc.duration/step))},(_,i)=>{
          const pitches=[...new Set(notes.filter(n=>n.time < (i+1)*step && n.time+n.duration>i*step).map(n=>n.midi))];
          const token=pitches.length?'('+pitches.map(p=>names[p%12]+(Math.floor(p/12)-1)).join(' ')+').16':'r.16';
          return token+(i%16===15?' |':'');
        });
        instance.settings.display.staveProfile=at.StaveProfile.Score;instance.updateSettings();
        instance.tex('\\title "MIDI – quantisierte Ansicht" \\tempo '+(doc.bpm||120)+' . '+cells.join(' '));
      }
    }).catch(e=>{if(!disposed)setError(String(e));});
    return ()=>{disposed=true;api.current?.destroy();api.current=null;};
  },[doc,track,notes]);
  return <><p className="analysis-hint score-description">{doc.gp?'Guitar-Pro-Noten und Originaltabulatur · alphaTab':'MIDI-Noten: vereinfachte 1/16-Quantisierung, maximal 256 Takte. MIDI enthält keine Originaltabulatur.'}</p>{error&&<p role="alert">{error}</p>}<div className="notation-sheet" ref={host}/></>;
}
