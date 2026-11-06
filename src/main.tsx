import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowLeft, ArrowRight, Check, ChevronDown, FileAudio, FolderOpen, Guitar, Headphones, HelpCircle, KeyboardMusic, Link2, LoaderCircle, MoreHorizontal, Music2, Pause, Play, Plus, Repeat2, Save, SlidersHorizontal, Trash2, Volume2, X } from 'lucide-react';
import { invoke, convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Fretboard, Waterfall } from './Instrument';
import { demoNotes, formatTime, isActive, loopTarget, noteName, parseMidi, peaksFrom, synthWav, validLoop, type Loop, type Note, type NoteTrack, type Session } from './music';
import { loadSessions, saveSessions } from './storage';
import { parseGuitarPro } from './guitarPro';
import { AnalysisPanel } from './AnalysisPanel';
import type { AnalysisResult } from './analysis';
import { ScoreStudio, type ScoreDocument, type ScorePlaybackState } from './ScoreStudio';
import { findCachedAnalysis, loadMaterial, saveMaterial, samePassage, serializeScore, restoreScore, type LoopMaterial } from './loopMaterials';
import { Notation } from './Notation';
import { NoteEditor } from './NoteEditor';
import { TabTools } from './TabTools';
import './style.css';

type Media = { key: string; name: string; url: string; kind: 'audio' | 'video'; demo?: boolean; midiOnly?: boolean; nativePath?: string; blob?: Blob };
function App() {
  const [area,setArea]=useState<'studio'|'tools'>('studio');
  const player = useRef<HTMLVideoElement>(null);
  const [scoreDocument, setScoreDocument] = useState<ScoreDocument | null>(null);
  const [scoreState,setScoreState]=useState<ScorePlaybackState|null>(null), [scoreVersion,setScoreVersion]=useState(0);
  const [selectedLoopId,setSelectedLoopId]=useState<string|null>(null), [restoring,setRestoring]=useState(false);
  const materialEditable=useRef(true), materialRevision=useRef(0);
  const materialRevisions=useRef(new Map<string,number>()), pendingMaterials=useRef(new Map<string,Promise<string>>());
  const restoreGeneration=useRef(0), loopsRef=useRef<Loop[]>([]);
  const mediaInput = useRef<HTMLInputElement>(null), midiInput = useRef<HTMLInputElement>(null);
  const fileGeneration = useRef(0), midiGeneration = useRef(0);
  const store = useRef<Session[]>([]), saveQueue = useRef(Promise.resolve());
  const [ready, setReady] = useState(false);
  const [media, setMedia] = useState<Media | null>(null);
  const [duration, setDuration] = useState(0), [time, setTime] = useState(0), [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1), [volume, setVolume] = useState(0.7);
  const [a, setA] = useState<number | null>(null), [b, setB] = useState<number | null>(null), [looping, setLooping] = useState(false);
  const [loops, setLoops] = useState<Loop[]>([]), [loopName, setLoopName] = useState('');
  const [notes, setNotes] = useState<Note[]>([]), [tracks, setTracks] = useState<NoteTrack[]>([]), [track, setTrack] = useState(-1);
  const [midiName, setMidiName] = useState(''), [offset, setOffset] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]), [waveState, setWaveState] = useState('');
  const [view, setView] = useState<'guitar' | 'piano' | 'notation' | 'edit'>('notation'), [leftHanded, setLeftHanded] = useState(false);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [help, setHelp] = useState(false), [dragging, setDragging] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null), [noteSource, setNoteSource] = useState<'score' | 'analysis'>('score');
  const [sourceVersion, setSourceVersion] = useState(0);
  const visibleNotes = useMemo(() => track < 0 ? notes : notes.filter(n => n.track === track), [track, notes]);
  loopsRef.current=loops;
  const currentRange=useRef({a,b});currentRange.current={a,b};
  const [analysisEditorVersion,setAnalysisEditorVersion]=useState(0);
  const analysisDocument=useMemo<ScoreDocument>(()=>({id:'analysis-'+sourceVersion,name:midiName || 'Loop-Noten',notes,tracks,duration:analysis?analysis.end-analysis.start:duration,bpm:120,edited:analysis?.edited??false}),[sourceVersion,midiName,notes,tracks,analysis,duration]);
  const noteTime = time - offset;
  const activeNotes = [...new Set(visibleNotes.filter(n => isActive(n, noteTime)).map(n => n.midi))];
  const loopValid = validLoop(a, b, duration);

  function setSource(source: Media) {
    restoreGeneration.current++;materialEditable.current=true;setSelectedLoopId(null);setRestoring(false);
    player.current?.pause();
    const session = store.current.find(s => s.key === source.key);
    setMedia(source); setDuration(0); setTime(0); setPlaying(false); setA(null); setB(null); setLooping(false);
    setLoops(session?.loops || []); setSpeed(session?.speed || 1); setOffset(session?.offset || 0);
    setNotes([]); setTracks([]); setTrack(-1); setMidiName(''); setPeaks([]); setWaveState(''); setMessage(''); setBusy(false);
    midiGeneration.current++;
    setAnalysis(null); setNoteSource('score'); setSourceVersion(value => value + 1);
  }

  function loadDemo() {
    fileGeneration.current++;
    const demo = demoNotes(); const audio = synthWav(demo, 19.2);
    setSource({ key: 'demo-v1', name: 'Evening practice', url: URL.createObjectURL(audio.blob), blob: audio.blob, kind: 'audio', demo: true });
    setNotes(demo); setTracks([{ id: 0, name: 'Akustische Skizze', count: demo.length }]); setMidiName('Mitgelieferte Demo-Noten');
    setPeaks(peaksFrom(audio.samples)); setBusy(false);
  }
  useEffect(() => {
    let cancelled = false;
    loadSessions().then(data => { store.current = data; }).catch(() => setMessage('Gespeicherte Übungen konnten nicht geladen werden.')).finally(() => { if (!cancelled) { setReady(true); loadDemo(); } });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => () => { if (media?.url.startsWith('blob:')) URL.revokeObjectURL(media.url); }, [media?.url]);
  useEffect(() => {
    if (!ready || !media) return;
    const session: Session = { key: media.key, loops, speed, offset };
    store.current = [session, ...store.current.filter(item => item.key !== media.key)].slice(0, 100);
    const snapshot = [...store.current];
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => saveSessions(snapshot)).catch(() => setMessage('Übungen konnten nicht gespeichert werden. Bitte Speicherplatz und Berechtigungen prüfen.'));
  }, [ready, media?.key, loops, speed, offset]);
  useEffect(() => { if (player.current) { player.current.playbackRate = speed; player.current.preservesPitch = true; } }, [speed, media]);
  useEffect(() => { if (player.current) player.current.volume = volume; }, [volume, media]);
  useEffect(() => {
    let frame = 0, last = 0;
    const tick = (stamp: number) => {
      const video = player.current;
      if (video && !video.paused) {
        if (looping && loopValid) { const target = loopTarget(video.currentTime, a!, b!, true); if (target !== null) video.currentTime = target; }
        if (stamp - last > 30) { setTime(video.currentTime); last = stamp; }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [looping, loopValid, a, b]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.code === 'Escape') { setHelp(false); return; }
      if (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName)) return;
      if (event.ctrlKey || event.metaKey || event.altKey || help || area!=='studio') return;
      if (event.code === 'Space') { event.preventDefault(); void togglePlay(); }
      if (event.code === 'KeyA') markA();
      if (event.code === 'KeyB') markB();
      if (event.code === 'KeyL' && loopValid) setLooping(value => !value);
      if (event.code === 'ArrowLeft') { event.preventDefault(); seek(time - 5); }
      if (event.code === 'ArrowRight') { event.preventDefault(); seek(time + 5); }
    }
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  });
  function seek(value: number) { if (player.current && duration) { const next = Math.max(0, Math.min(duration, value)); player.current.currentTime = next; setTime(next); } }
  async function togglePlay() {
    const video = player.current; if (!video || !media) return;
    if (video.paused) { if (video.ended) seek(looping && a !== null ? a : 0); try { await video.play(); } catch { setMessage('Die Datei kann nicht wiedergegeben werden. Versuche MP3, WAV oder MP4 mit H.264/AAC.'); } }
    else video.pause();
  }
  function markA() { setA(time); if (b !== null && b <= time + 0.1) { setB(null); setLooping(false); } }
  function markB() {
    const start = a ?? 0;
    if (time - start < 0.1) { setMessage('Punkt B muss mindestens 0,1 Sekunden hinter A liegen.'); return; }
    setA(start); setB(time); setLooping(true); setMessage('');
  }
  async function saveLoop() {
    if (!loopValid) return;
    if (loops.length >= 500) { setMessage('Für diese Datei sind bereits 500 Loops gespeichert.'); return; }
    const id=crypto.randomUUID(),generation=restoreGeneration.current;
    try {
      const materialId=await saveMaterial({version:1,analysis:analysis&&samePassage(a,b,analysis.start,analysis.end)?analysis:null,score:scoreDocument?serializeScore(scoreDocument):null,scoreState,analysisTrack:track,offset});
      if(generation!==restoreGeneration.current)return;
      setLoops(old=>[...old,{id,name:loopName.trim() || `Passage ${old.length+1}`,start:a!,end:b!,materialId}]);
      materialEditable.current=true;setSelectedLoopId(id);setLoopName('');
    }catch(e){setMessage(`Loop konnte nicht gespeichert werden: ${e}`);}
  }
  // Keep large notes/GP data outside sessions.json; each loop stores a content ID.
  useEffect(()=>{
    const saved=loopsRef.current.find(l=>l.id===selectedLoopId);
    if(!materialEditable.current || !saved || restoring || !samePassage(a,b,saved.start,saved.end))return;
    const generation=fileGeneration.current, revision=++materialRevision.current;
    const material:LoopMaterial={version:1,analysis:analysis&&samePassage(a,b,analysis.start,analysis.end)?analysis:null,score:scoreDocument?serializeScore(scoreDocument):null,scoreState,analysisTrack:track,offset};
    materialRevisions.current.set(saved.id,revision);
    const pending=saveMaterial(material);pendingMaterials.current.set(saved.id,pending);
    void pending.then(materialId=>{
      if(generation!==fileGeneration.current || materialRevisions.current.get(saved.id)!==revision)return;
      setLoops(old=>old.map(l=>l.id===saved.id&&samePassage(l.start,l.end,saved.start,saved.end)?{...l,materialId}:l));
    }).catch(e=>{if(generation===fileGeneration.current)setMessage(`Notendaten konnten nicht gespeichert werden: ${e}`);})
      .finally(()=>{if(pendingMaterials.current.get(saved.id)===pending)pendingMaterials.current.delete(saved.id);});
  },[selectedLoopId,restoring,a,b,analysis,scoreDocument,scoreState,track,offset]);

  async function chooseLoop(loop:Loop) {
    setAnalysisEditorVersion(v=>v+1);
    const request=++restoreGeneration.current;materialEditable.current=false;midiGeneration.current++;setBusy(false);
    setSelectedLoopId(loop.id);setRestoring(true);setA(loop.start);setB(loop.end);setLooping(true);seek(loop.start);
    setAnalysis(null);setNoteSource('score');setNotes([]);setTracks([]);setTrack(-1);setMidiName('');setScoreDocument(null);setScoreState(null);
    setMessage('Gespeicherte Spuren und Noten werden geladen …');
    try {
      const materialId=await pendingMaterials.current.get(loop.id) || loop.materialId;
      if(request!==restoreGeneration.current)return;
      let material=materialId?await loadMaterial(materialId):null;
      if(request!==restoreGeneration.current)return;
      if(!material && media){
        let source=media.nativePath;
        if(!source&&media.blob&&isTauri())source=await invoke<string>('stage_media',await media.blob.arrayBuffer());
        if(request!==restoreGeneration.current)return;
        const cached=source?await findCachedAnalysis(source,loop.start,loop.end):null;
        if(cached)material={version:1,analysis:cached,score:null,scoreState:null,analysisTrack:cached.stems.find(s=>s.source==='guitar')?.id??cached.stems[0].id,offset:cached.start};
      }
      if(request!==restoreGeneration.current)return;
      materialEditable.current=true;
      if(material){
        setOffset(material.offset);setScoreState(material.scoreState);
        if(material.score){setScoreDocument(restoreScore(material.score));setScoreVersion(v=>v+1);}
        if(material.analysis){setAnalysis(material.analysis);showStem(material.analysis,material.analysisTrack);setOffset(material.offset);}
        setMessage(material.analysis||material.score?'Gespeicherte Spuren und Noten wiederhergestellt.':'Loop geladen. Für diese Passage sind noch keine Notendaten gespeichert.');
      }else setMessage('Für diese Passage sind noch keine Spuren oder Notendateien gespeichert.');
    }catch(e){if(request===restoreGeneration.current)setMessage(`Gespeicherte Notendaten konnten nicht geladen werden: ${e}`);}
    finally{if(request===restoreGeneration.current)setRestoring(false);}
  }
  function acceptAnalysis(result:AnalysisResult){
    const range=currentRange.current;
    if(!samePassage(range.a,range.b,result.start,result.end))return;
    materialEditable.current=true;
    const saved=loopsRef.current.find(l=>l.id===selectedLoopId&&samePassage(range.a,range.b,l.start,l.end)) || loopsRef.current.find(l=>samePassage(range.a,range.b,l.start,l.end));
    if(saved)setSelectedLoopId(saved.id);
    setAnalysisEditorVersion(v=>v+1);setAnalysis(result);
    const chosen=result.stems.find(s=>s.source==='guitar'&&s.notes.length)||result.stems.find(s=>s.notes.length)||result.stems[0];
    showStem(result,chosen.id);
  }
  async function decodeWave(file: Blob, generation: number) {
    if (file.size > 200 * 1024 * 1024) { setWaveState('Zeitleiste · Wellenform bei Dateien bis 200 MB'); return; }
    setWaveState('Wellenform wird gelesen …');
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      if (generation !== fileGeneration.current) return;
      setPeaks(peaksFrom(buffer.getChannelData(0))); setWaveState('');
    } catch { if (generation === fileGeneration.current) setWaveState('Zeitleiste · für dieses Format ist keine Wellenform verfügbar'); }
    finally { await context.close(); }
  }
  async function loadFile(file: File) {
    if (/\.(mid|midi|gp3|gp4|gp5|gpx|gp)$/i.test(file.name)) { await loadMidi(file); return; }
    const kind = file.type.startsWith('video') || /\.(mp4|webm|mov|mkv|m4v)$/i.test(file.name) ? 'video' : 'audio';
    if (!file.type.startsWith('audio') && !file.type.startsWith('video') && !/\.(mp3|wav|flac|ogg|m4a|aac|mp4|webm|mov|mkv|m4v)$/i.test(file.name)) { setMessage('Bitte eine Audio-, Video-, MIDI- oder Guitar-Pro-Datei auswählen.'); return; }
    const generation = ++fileGeneration.current;
    setSource({ key: `${file.name}:${file.size}:${file.lastModified}`, name: file.name, url: URL.createObjectURL(file), blob: file, kind });
    if (kind === 'audio') void decodeWave(file, generation);
    else setWaveState('Video-Zeitleiste');
  }
  async function chooseMedia() {
    if (!isTauri()) { mediaInput.current?.click(); return; }
    try {
      const path = await open({ multiple: false, directory: false, filters: [{ name: 'Musik & Video', extensions: ['mp3','wav','flac','ogg','m4a','aac','mp4','webm','mov','mkv'] }] });
      if (!path) return;
      fileGeneration.current++;
      const name = path.split(/[\\/]/).pop() || path;
      const kind = /\.(mp4|webm|mov|mkv)$/i.test(name) ? 'video' : 'audio';
      setSource({ key: path, name, url: convertFileSrc(path), kind, nativePath: path });
      setWaveState('Lokale Datei · Zeitleiste');
    } catch { setMessage('Die Dateiauswahl konnte nicht geöffnet werden. Du kannst die Datei auch ins Fenster ziehen.'); }
  }
  async function loadMidi(file: File) {
    let generation = ++midiGeneration.current;
    restoreGeneration.current++;setRestoring(false);materialEditable.current=true;
    setBusy(true); setMessage('');
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Notendateien dürfen maximal 20 MB groß sein.');
      const buffer = await file.arrayBuffer();
      const parsed = /\.(gp3|gp4|gp5|gpx|gp)$/i.test(file.name) ? await parseGuitarPro(buffer) : parseMidi(buffer);
      if (generation !== midiGeneration.current) return;
      materialEditable.current=true;setScoreState(null);setScoreVersion(v=>v+1);
      setScoreDocument({ ...parsed, id: crypto.randomUUID(), name: file.name, gp: /\.(gp3|gp4|gp5|gpx|gp)$/i.test(file.name) ? buffer : undefined });
    } catch (error) { if (generation === midiGeneration.current) setMessage(error instanceof Error ? error.message : 'Die Notendatei konnte nicht gelesen werden.'); }
    finally { if (generation === midiGeneration.current) setBusy(false); }
  }

  function editAnalysisNotes(next:Note[]) {
    if(!analysis)return;
    const updated={...analysis,edited:true,stems:analysis.stems.map(stem=>({...stem,notes:next.filter(n=>n.track===stem.id)}))};
    setAnalysis(updated);setNotes(next);setTracks(updated.stems.map(stem=>({id:stem.id,name:stem.name,count:stem.notes.length})));
  }
  function showStem(result: AnalysisResult, id: number) {
    setNotes(result.stems.flatMap(stem => stem.notes));
    setTracks(result.stems.map(stem => ({ id: stem.id, name: stem.name, count: stem.notes.length })));
    setTrack(id); setOffset(result.start); setNoteSource('analysis');
    setMidiName(`Analyse · ${formatTime(result.start)} – ${formatTime(result.end)}`);
  }

  return <div className="app" onDragOver={event => { if(area!=='studio')return;event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { if(area!=='studio')return;event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void loadFile(file); }}>
    <input ref={mediaInput} type="file" accept="audio/*,video/*,.mid,.midi,.gp3,.gp4,.gp5,.gpx,.gp" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.target.value = ''; }}/>
    <input ref={midiInput} type="file" accept=".mid,.midi,.gp3,.gp4,.gp5,.gpx,.gp" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void loadMidi(file); event.target.value = ''; }}/>
    <nav className="area-mobile" aria-label="Arbeitsbereich"><button onClick={()=>setArea('studio')}>Übungsraum</button><button onClick={()=>{player.current?.pause();setArea('tools');}}>Tab-Werkzeuge</button></nav>
      <aside className="sidebar">
      <div className="brand"><span className="brand-icon"><Activity size={22}/></span>Loop<span>Studio</span></div>
      <div className="sidebar-caption">DEIN ÜBUNGSRAUM</div>
      <button className={area==='studio'?'nav-active':'nav-button'} title="Übungsraum" onClick={()=>setArea('studio')}><SlidersHorizontal size={17}/> Übungsraum {area==='studio'&&<span className="nav-dot"/>}</button>
      <button className={area==='tools'?'nav-active':'nav-button'} title="Tab-Werkzeuge" onClick={()=>{player.current?.pause();setPlaying(false);setDragging(false);setArea('tools');}}><Music2 size={17}/> Tab-Werkzeuge {area==='tools'&&<span className="nav-dot"/>}</button>
      <div style={{display:area==='studio'?undefined:'none'}}>
      <button className="nav-button" onClick={() => void chooseMedia()}><FolderOpen size={17}/> Datei öffnen <Plus size={15}/></button>
      <div className="sidebar-caption section-gap">AKTUELLE SESSION</div>
      <div className="current-file"><span className="file-icon"><Music2 size={18}/></span><div><strong>{media?.name || 'Keine Datei'}</strong><small>{media?.demo ? 'Demo · C / Am / F / G' : media?.kind === 'video' ? 'Lokales Musikvideo' : media?.midiOnly ? 'Notendatei · synthetische Wiedergabe' : 'Lokale Audiodatei'}</small></div></div>
      <div className="sidebar-caption section-gap">GESPEICHERTE LOOPS <span>{loops.length.toString().padStart(2, '0')}</span></div>
      <div className="saved-loops">{loops.length === 0 ? <div className="empty-loops"><Repeat2 size={22}/><p>Eine gute Passage?<br/>Setze A und B und speichere sie hier.</p></div> : loops.map(loop => <div className="saved-loop" key={loop.id}><button onClick={() => void chooseLoop(loop)}><Repeat2 size={15}/><span><strong>{loop.name}</strong><small>{formatTime(loop.start)} – {formatTime(loop.end)}</small></span></button><button className="delete" title={`Loop ${loop.name} löschen`} onClick={() => setLoops(loops.filter(item => item.id !== loop.id))}><Trash2 size={13}/></button></div>)}</div>
      </div>
      <div className="sidebar-bottom"><div className="local-badge"><span/> Lokal auf deinem Gerät</div><button className="nav-button" onClick={() => setHelp(true)}><HelpCircle size={16}/> Hilfe & Tastenkürzel</button><small>LoopStudio <span>0.6.0 · Local Studio</span></small></div>
    </aside>
    <main style={{display:area==='studio'?undefined:'none'}}>
      <header className="topbar"><div className="breadcrumb">Arbeitsplatz <span>/</span> <strong>Studio</strong></div><div className="header-actions"><span className="privacy"><span/> LOKAL AUF DEINEM PC</span><button className="button light" onClick={() => void chooseMedia()}><Plus size={16}/> Datei öffnen</button></div></header>
      <div className="workspace">
        <section className="heading"><div><div className="eyebrow">WENIGER SUCHEN. MEHR SPIELEN.</div><h1>Deine nächste gute Wiederholung.</h1><p>Hör genau hin. Finde deine Passage. Mach sie zu deiner.</p></div><button className="button subtle" onClick={loadDemo}><Headphones size={16}/> Demo laden</button></section>
        {message && <div className="notice" role="alert">{message}<button title="Hinweis schließen" onClick={() => setMessage('')}><X size={16}/></button></div>}
        <section className="player-card">
          <div className="card-heading"><div><span className="tiny-dot"/> PLAYER <span className="tag">{media?.kind === 'video' ? 'VIDEO' : 'AUDIO'}</span></div><span className="muted">{media?.demo ? 'Original-Demo · 100 BPM' : 'Datei bleibt auf deinem Gerät'}</span></div>
          <div className={`media-stage ${media?.kind === 'video' ? 'video-mode' : ''}`}>
            <video ref={player} src={media?.url} playsInline preload="metadata" onLoadedMetadata={() => { const d = player.current?.duration || 0; setDuration(Number.isFinite(d) ? d : 0); if (player.current) { player.current.playbackRate = speed; player.current.volume = volume; player.current.preservesPitch = true; } }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={() => { if (player.current?.paused) setTime(player.current.currentTime); }} onEnded={() => { if (looping && loopValid) { seek(a!); void player.current?.play(); } else setPlaying(false); }} onError={() => { if (media) setMessage('Dieses Medienformat konnte nicht geöffnet werden. MP3/WAV und MP4 mit H.264/AAC sind gute Ausgangsformate.'); }}/>
            {media?.kind !== 'video' && <><div className={`record-art ${playing ? 'spinning' : ''}`}><div className="record-label"><Activity size={28}/></div></div><div className="track-info"><div className="eyebrow">{media?.demo ? 'DEIN ERSTER DURCHLAUF' : 'JETZT IM STUDIO'}</div><h2>{media?.name || 'Öffne deine Musik'}</h2><p>{media?.demo ? 'Eine kleine Akkordfolge. Viel Platz zum Üben.' : midiName ? 'Audio und Noten gemeinsam im Blick.' : 'Analysiere eine Passage oder lade MIDI / Guitar Pro dazu.'}</p><div className="track-tags"><span><FileAudio size={12}/> {media?.midiOnly ? 'Noten-Synthese' : 'Lokale Wiedergabe'}</span><span>{duration ? formatTime(duration) : '—'}</span></div></div><div className="sound-lines" aria-hidden="true">{[24,42,30,62,48,76,38,56,29].map((h,i) => <i key={i} style={{height:h,animationDelay:`${i*0.1}s`,animationPlayState:playing?'running':'paused'}}/>)}</div></>}
          </div>
          <div className="timeline-wrap"><div className="time-labels"><span>{formatTime(time)}</span><span>{waveState || (looping && loopValid ? `Loop · ${formatTime(b! - a!)}` : 'DEINE PASSAGE IM BLICK')}</span><span>{formatTime(duration)}</span></div><div className="waveform">
            <svg viewBox="0 0 1000 62" preserveAspectRatio="none" aria-hidden="true">{peaks.length ? peaks.map((peak,i) => <rect key={i} x={i/peaks.length*1000} y={31-Math.max(1,peak*27)} width={1000/peaks.length*0.65} height={Math.max(2,peak*54)} rx="0.5" fill={i/peaks.length <= time/(duration||1)?'#bbef8d':'#455e50'}/>) : <line x1="0" x2="1000" y1="31" y2="31" stroke="#455e50" strokeWidth="2"/>}</svg>
            {a !== null && <span className="loop-marker" style={{left:`${a/(duration||1)*100}%`}}>A</span>}{b !== null && <span className="loop-marker b-marker" style={{left:`${b/(duration||1)*100}%`}}>B</span>}
            {loopValid && <div className="loop-region" style={{left:`${a!/(duration||1)*100}%`,width:`${(b!-a!)/(duration||1)*100}%`}}/>}
            <div className="playhead" style={{left:`${time/(duration||1)*100}%`}}/>
            <input className="seek" aria-label="Wiedergabeposition" type="range" min="0" max={duration || 1} step="0.01" value={Math.min(time,duration||1)} onChange={event => seek(+event.target.value)}/>
          </div></div>
          <div className="transport"><div className="playback"><button className="icon-button" title="5 Sekunden zurück (←)" onClick={() => seek(time-5)}><ArrowLeft size={18}/><small>5</small></button><button className="play-button" title={playing?'Pause (Leertaste)':'Abspielen (Leertaste)'} disabled={!duration} onClick={() => void togglePlay()}>{playing?<Pause size={21} fill="currentColor"/>:<Play size={21} fill="currentColor"/>}</button><button className="icon-button" title="5 Sekunden vor (→)" onClick={() => seek(time+5)}><small>5</small><ArrowRight size={18}/></button><span className="transport-divider"/><button className={`icon-button ${looping?'selected':''}`} title="Loop umschalten (L)" disabled={!loopValid} onClick={() => setLooping(!looping)}><Repeat2 size={20}/></button></div><div className="tempo"><span>Tempo</span><select aria-label="Wiedergabegeschwindigkeit" value={speed} onChange={event => setSpeed(+event.target.value)}>{[0.25,0.5,0.6,0.7,0.75,0.8,0.9,1,1.1,1.25,1.5,2].map(rate => <option key={rate} value={rate}>{Math.round(rate*100)} %</option>)}</select><span className="pitch-preserved">Tonhöhe bleibt</span></div><div className="volume"><Volume2 size={18}/><input type="range" aria-label="Lautstärke" min="0" max="1" step="0.01" value={volume} onChange={event => setVolume(+event.target.value)}/></div></div>
          <div className="loop-bar"><span className="loop-label"><Repeat2 size={15}/> Passage loopen</span><button className={`marker-button ${a!==null?'set':''}`} onClick={markA} disabled={!duration}><kbd>A</kbd> {a!==null?formatTime(a):'Start setzen'}</button><span className="muted">→</span><button className={`marker-button ${b!==null?'set':''}`} onClick={markB} disabled={!duration}><kbd>B</kbd> {b!==null?formatTime(b):'Ende setzen'}</button><button className="icon-button" title="Loop zurücksetzen" disabled={a===null&&b===null} onClick={() => {setA(null);setB(null);setLooping(false);}}><X size={15}/></button><div className="save-loop"><input aria-label="Name des Loops" placeholder="Passage benennen …" maxLength={100} value={loopName} onChange={event => setLoopName(event.target.value)} onKeyDown={event => {if(event.key==='Enter')saveLoop();}}/><button className="button subtle small" disabled={!loopValid} onClick={saveLoop}><Save size={14}/> Speichern</button></div></div>
        </section>
        {media && <AnalysisPanel key={sourceVersion} player={player} nativePath={media.nativePath} blob={media.blob} start={a} end={b} valid={loopValid} volume={volume} result={analysis} selected={noteSource === 'analysis' ? track : null} onResult={acceptAnalysis} onSelect={id => { if (analysis) showStem(analysis, id); }}/>}
        {scoreDocument && <ScoreStudio key={`${scoreDocument.id}:${scoreVersion}`} active={area==='studio'} initialState={scoreState} onStateChange={setScoreState} onChange={setScoreDocument} document={scoreDocument} media={player} mediaKey={media?.key || ""} a={a} b={b} onLoad={() => midiInput.current?.click()}/>}
        <section className="instrument-card"><div className="instrument-toolbar"><div className="tabs" role="tablist" aria-label="Instrumentenansicht"><button role="tab" aria-selected={view==='notation'} onClick={()=>setView('notation')} className={view==='notation'?'active':''}><Music2 size={17}/> Noten & Tabulatur</button><button role="tab" aria-selected={view==='guitar'} onClick={() => setView('guitar')} className={view==='guitar'?'active':''}><Guitar size={17}/> Griffbrett</button><button role="tab" aria-selected={view==='piano'} onClick={() => setView('piano')} className={view==='piano'?'active':''}><KeyboardMusic size={18}/> Piano Waterfall</button><button role="tab" aria-selected={view==='edit'} onClick={()=>setView('edit')} className={view==='edit'?'active':''}>Noten bearbeiten</button></div><button className="button subtle small" disabled={busy} onClick={() => midiInput.current?.click()}>{busy?<LoaderCircle size={14} className="spinner"/>:<Plus size={14}/>} MIDI / GP5 laden</button></div>
          <div className="note-track-picker"><label>Angezeigte Spur <select aria-label="Angezeigte Notenspur" value={track} disabled={!tracks.length} onChange={event => setTrack(+event.target.value)}><option value={-1}>Alle Tonspuren</option>{tracks.map(t => <option key={t.id} value={t.id}>{t.name} · {t.count} Noten</option>)}</select></label><label title="Positiver Wert: Die Noten starten später in der Aufnahme">Notenstart in Aufnahme <input type="number" min="-86400" max="86400" step="0.1" aria-label="Notenstart in Sekunden" value={offset} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && Math.abs(value) <= 86400) setOffset(value); }}/> s</label><span>{noteSource === 'analysis' ? 'Automatisch erkannt' : 'MIDI / Guitar Pro'} · folgt dem Player</span></div>
          <div className="instrument-info"><div><span className="tiny-dot"/>{view==='guitar'?'STANDARDSTIMMUNG · E A D G H E':view==='piano'?'KLAVIER · C2 BIS C7':'NOTEN DER GEWÄHLTEN SPUR'}<span className="muted">{view==='guitar'?'Zugeordnete Saiten und Bünde':view==='piano'?'5 Sekunden Vorschau':'Folgt der Aufnahme'}</span></div>{view==='guitar'&&<label className="checkbox"><input type="checkbox" checked={leftHanded} onChange={event => setLeftHanded(event.target.checked)}/> Linkshändig</label>}</div>
          {(view==='notation'||view==='edit')&&<Notation doc={analysisDocument} track={track} notes={visibleNotes} time={noteTime}/>}
          {view==='edit'&&(analysis?<NoteEditor key={`${sourceVersion}:${selectedLoopId}:${analysisEditorVersion}`} notes={notes} track={track} duration={analysis.end-analysis.start} time={noteTime} onChange={editAnalysisNotes} onSeek={value=>seek(value+offset)}/>:<p className="analysis-hint score-description">Eine Passage analysieren oder eine MIDI-/Guitar-Pro-Datei im Notenplayer öffnen, um Noten zu bearbeiten.</p>)}
          {view==='guitar'&&<Fretboard notes={visibleNotes} time={noteTime} leftHanded={leftHanded}/>}
          {view==='piano'&&<Waterfall notes={visibleNotes} time={noteTime} playing={playing}/>}
          <div className="note-status"><span>JETZT</span><div className="note-chips">{activeNotes.length?activeNotes.map(n => <span key={n}>{noteName(n,true)}</span>):<small>{notes.length?'—':'Spur analysieren oder MIDI / GP5 laden'}</small>}</div><span className="note-source">{midiName?<><Link2 size={12}/>{midiName}</>: 'Noch keine Notendaten'}</span></div>

        </section>
        <footer className="workspace-footer"><span><Check size={14}/> Dateien bleiben lokal. Loops werden automatisch gespeichert.</span><button onClick={() => setHelp(true)}>Tastenkürzel <kbd>?</kbd></button></footer>
      </div>
    </main>
    <div className="tab-tools-host" style={{display:area==='tools'?undefined:'none'}}><TabTools active={area==='tools'} onImport={document=>{midiGeneration.current++;restoreGeneration.current++;setRestoring(false);setBusy(false);materialEditable.current=true;player.current?.pause();setPlaying(false);setScoreDocument(document);setScoreState(null);setScoreVersion(v=>v+1);setArea('studio');setMessage('Notenfassung aus den Tab-Werkzeugen geöffnet. Zum Hinterlegen beim Loop die Passage speichern oder einen gespeicherten Loop verwenden.');}}/></div>
    {dragging&&<div className="drop-overlay"><FolderOpen size={42}/><h2>Deine Musik. Dein Tempo.</h2><p>Audio, Video, MIDI oder Guitar Pro hier ablegen</p></div>}
    {help&&<div className="modal-backdrop" onClick={() => setHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-label="Hilfe" onClick={event => event.stopPropagation()}><button autoFocus className="close-modal icon-button" onClick={() => setHelp(false)} title="Hilfe schließen"><X size={20}/></button><div className="eyebrow">DEIN SCHNELLSTART</div><h2>Ein Loop. Ein bisschen besser.</h2><p>Öffne eine lokale Audio- oder Videodatei. Setze beim Hören den Anfang mit A und das Ende mit B. Die Passage wiederholt sich, bis du den Loop ausschaltest.</p><dl><dt>Abspielen / Pause</dt><dd>Leertaste</dd><dt>Loop-Anfang / Ende</dt><dd>A / B</dd><dt>Loop an / aus</dt><dd>L</dd><dt>5 Sekunden springen</dt><dd>← / →</dd></dl><h3>Noten sichtbar machen</h3><p>Analysiere eine A/B-Passage bis 3 Minuten, um sechs Instrumentenspuren und erkannte Noten zu erhalten. Klicke im Mixer auf ein Instrument; seine Noten folgen dem Player. Mit M/S und den Reglern hörst du einzelne Spuren. Außerhalb der analysierten Passage läuft das Original. Alternativ: MIDI oder Guitar Pro (auch GP5) laden und die angezeigte Spur auswählen. „Notenstart in Aufnahme“ richtet die Noten zur Aufnahme aus. Der eigene Notenplayer spielt MIDI und Guitar Pro unabhängig von der Aufnahme. Wähle in beiden Playern eine Passage, verknüpfe sie und aktiviere „Aufnahme folgen“. Die Zuordnung passt Position und Tempo an. Im Notenplayer steuert die Spurauswahl auch den Syntheseklang.</p><p>Das Griffbrett zeigt gespeicherte Guitar-Pro-Positionen oder eine KI-gestützte Griffzuordnung pro Note. Wähle dafür eine einzelne Spur. Zusätzliche Gitarrenstimmen sind separat auswählbar. H entspricht dem internationalen B. Die Demo enthält bereits passende Noten.</p><div className="help-note">Demucs trennt Gitarre, Piano, Bass, Schlagzeug, Gesang und weitere Instrumente. Basic Pitch schätzt die Tonhöhen. Ergebnisse sind keine fehlerfreien Transkriptionen; besonders Piano und leise Instrumente können unvollständig sein. Schlagzeug erhält keine Klaviernoten. Unterstützte Medienformate hängen von Windows/WebView2 ab.</div><p className="muted">Es wird nichts hochgeladen. Analysen und importierte Dateien aus Drag & Drop liegen im lokalen App-Cache. Für dieselbe Datei und Passage werden vorhandene Analysen wiederverwendet. Nach einem Neustart die Datei erneut öffnen; gespeicherte Loops und Tempo werden wiederhergestellt.</p></section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
