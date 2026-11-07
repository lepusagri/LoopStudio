import {loopForScore,analysisForRange} from './loopResize';
import {LoopTabTool} from './LoopTabTool';
import {loopScoreFit,type TabDraft} from './loopTabs';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ensureGp7, reconcileScoreState } from './gp7Document';
import { flushOpenEditor, hasOpenEditor } from './editorSession';
import { Activity, ArrowLeft, ArrowRight, Check, ChevronDown, FileAudio, FolderOpen, Guitar, Headphones, HelpCircle, KeyboardMusic, Link2, LoaderCircle, MoreHorizontal, Music2, Pause, Play, Plus, Repeat2, Save, SlidersHorizontal, Trash2, Volume2, X } from 'lucide-react';
import { invoke, convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { closeAfterSaving } from './windowClose';
import { ProjectHome } from './ProjectHome';
import { ProjectHeads } from './projectHeads';
import { listProjects, openProject, createProject, saveProject, emptyWorkspace, type OpenProject, type RecentProject, type NewProject } from './projects';
import { demoNotes, formatTime, loopTarget, parseMidi, peaksFrom, synthWav, validLoop, type Loop, type Note, type NoteTrack, type Session } from './music';
import { loadSessions, saveSessions } from './storage';
import { parseGuitarPro } from './guitarPro';
import { AnalysisPanel } from './AnalysisPanel';
import type { AnalysisResult } from './analysis';
import { ScoreStudio, type ScoreDocument, type ScorePlaybackState } from './ScoreStudio';
import { findCachedAnalysis, loadMaterial, saveMaterial, samePassage, serializeScore, restoreScore, type LoopMaterial } from './loopMaterials';
import { TabTools } from './TabTools';
import { LoopRhythmPanel } from './LoopRhythmPanel';
import { GlobalSettingsPanel } from './GlobalSettingsPanel';
import { defaultSettings, loadGlobalSettings, saveGlobalSettings, type GlobalSettings } from './globalSettings';
import { Timeline } from './Timeline';
import { readWaveform } from './waveform';
import './style.css';

type Media = { key: string; name: string; url: string; kind: 'audio' | 'video'; demo?: boolean; midiOnly?: boolean; nativePath?: string; blob?: Blob };
function App() {
  const [area,setArea]=useState<'projects'|'studio'|'tools'|'settings'>('projects');
  const [globalSettings,setGlobalSettings]=useState<GlobalSettings>(defaultSettings),[globalSettingsReady,setGlobalSettingsReady]=useState(false),[globalSettingsError,setGlobalSettingsError]=useState('');
  useEffect(()=>{let alive=true;void loadGlobalSettings().then(value=>{if(alive){setGlobalSettings(value);setGlobalSettingsReady(true);}}).catch(e=>{if(alive)setGlobalSettingsError(String(e));});return()=>{alive=false;};},[]);
  function showSettings(){player.current?.pause();setPlaying(false);setDragging(false);setArea('settings');}
  const [project,setProject]=useState<OpenProject|null>(null),[recentProjects,setRecentProjects]=useState<RecentProject[]>([]);
  const [projectBusy,setProjectBusy]=useState(''),[projectError,setProjectError]=useState(''),[projectSaveState,setProjectSaveState]=useState('Gespeichert');
  const [createCurrent,setCreateCurrent]=useState(0),[saveAttempt,setSaveAttempt]=useState(0);
  const projectQueue=useRef<Promise<void>>(Promise.resolve()),projectTransition=useRef(false),projectLoading=useRef(false),projectRevision=useRef(0),workspaceId=useRef<string|null>(null),pendingSeek=useRef<number|null>(null);
  const projectHeads=useRef(new ProjectHeads());
  const projectRef=useRef(project);projectRef.current=project;
  const flushRef=useRef<()=>Promise<void>>(async()=>{});
  const [savingLoop,setSavingLoop]=useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const [tabDraft,setTabDraft]=useState<TabDraft>({clips:[]});
  const [scoreDocument, setScoreDocument] = useState<ScoreDocument | null>(null);
  const [scoreState,setScoreState]=useState<ScorePlaybackState|null>(null), [scoreVersion,setScoreVersion]=useState(0);
  const [selectedLoopId,setSelectedLoopId]=useState<string|null>(null), [restoring,setRestoring]=useState(false);
  const materialEditable=useRef(true), materialRevision=useRef(0);
  const materialRevisions=useRef(new Map<string,number>()), pendingMaterials=useRef(new Map<string,Promise<string>>());
  const restoreGeneration=useRef(0), loopsRef=useRef<Loop[]>([]);
  const mediaInput = useRef<HTMLInputElement>(null), midiInput = useRef<HTMLInputElement>(null);
  const fileGeneration = useRef(0), midiGeneration = useRef(0);
  const legacyLoaded=useRef(false);
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
  const [view, setView] = useState<'guitar' | 'piano' | 'notation' | 'edit'>('notation');
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [help, setHelp] = useState(false), [dragging, setDragging] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null), [noteSource, setNoteSource] = useState<'score' | 'analysis'>('score');
  const [sourceVersion, setSourceVersion] = useState(0);
  loopsRef.current=loops;
  const currentRange=useRef({a,b});currentRange.current={a,b};
  const [editRequest,setEditRequest]=useState(0);
  const storageFlushRef=useRef<()=>Promise<void>>(async()=>{});
  useEffect(()=>{
    if(!scoreDocument)return;
    setNotes(scoreDocument.notes);setTracks(scoreDocument.tracks);setMidiName(scoreDocument.name);
    setTrack(old=>scoreDocument.tracks.some(t=>t.id===old)?old:scoreDocument.tracks[0]?.id??-1);
    setNoteSource(scoreDocument.origin?.kind==='analysis'?'analysis':'score');
  },[scoreDocument]);
  const selectedLoop=loops.find(loop=>loop.id===selectedLoopId&&samePassage(a,b,loop.start,loop.end))??null;
  const loopRhythm=selectedLoop?.rhythm??{bpm:null,beatsPerBar:4,beatUnit:4,bars:null};
  function updateLoopRhythm(change:Partial<typeof loopRhythm>){if(selectedLoopId)setLoops(old=>old.map(loop=>loop.id===selectedLoopId?{...loop,rhythm:{...(loop.rhythm??{bpm:null,beatsPerBar:4,beatUnit:4,bars:null}),...change}}:loop));}
  const loopValid = validLoop(a, b, duration);

  function setSource(source: Media, projectSession?: Session) {
    projectHeads.current.clear();
    restoreGeneration.current++;materialEditable.current=true;setSelectedLoopId(null);setRestoring(false);
    player.current?.pause();
    const session = projectSession ?? store.current.find(s => s.key === source.key);
    setMedia(source); setDuration(0); setTime(0); setPlaying(false); setA(null); setB(null); setLooping(false);
    setLoops(session?.loops || []); setSpeed(session?.speed || 1); setOffset(session?.offset || 0);
    setNotes([]); setTracks([]); setTrack(-1); setMidiName(''); setPeaks([]); setWaveState(''); setMessage(''); setBusy(false);
    midiGeneration.current++;
    setAnalysis(null);setTabDraft({clips:[]});setScoreDocument(null);setScoreState(null);setScoreVersion(v=>v+1); setNoteSource('score'); setSourceVersion(value => value + 1);
  }

  async function loadDemo() {
    if(!ready || projectTransition.current || savingLoop || busy || restoring)return;
    projectTransition.current=true;setProjectBusy('Aktuelle Session wird gespeichert …');
    try{await flushSession();setProject(null);workspaceId.current=null;setArea('studio');
    fileGeneration.current++;
    const demo = demoNotes(); const audio = synthWav(demo, 19.2);
    setSource({ key: 'demo-v1', name: 'Evening practice', url: URL.createObjectURL(audio.blob), blob: audio.blob, kind: 'audio', demo: true });
    setNotes(demo); setTracks([{ id: 0, name: 'Akustische Skizze', count: demo.length }]); setMidiName('Mitgelieferte Demo-Noten');
    setPeaks(peaksFrom(audio.samples)); setBusy(false);
    setScoreDocument(await ensureGp7({id:crypto.randomUUID(),name:'Demo-Noten',notes:demo,tracks:[{id:0,name:'Gitarre',count:demo.length}],duration:19.2,bpm:100}));
    }catch(e){setProjectError(`Session konnte nicht gewechselt werden: ${e}`);}finally{projectTransition.current=false;setProjectBusy('');}
  }
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([loadSessions(),listProjects()]).then(([sessions,projects])=>{if(cancelled)return;if(sessions.status==='fulfilled'){store.current=sessions.value;legacyLoaded.current=true;}else setProjectError('Bisherige Übungen konnten nicht geladen werden.');if(projects.status==='fulfilled')setRecentProjects(projects.value);else setProjectError(String(projects.reason));setReady(true);});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => () => { if (media?.url.startsWith('blob:')) URL.revokeObjectURL(media.url); }, [media?.url]);
  useEffect(() => {
    if (!ready || !legacyLoaded.current || !media || project || projectTransition.current) return;
    const session: Session = { key: media.key, loops, speed, offset };
    store.current = [session, ...store.current.filter(item => item.key !== media.key)].slice(0, 100);
    const snapshot = [...store.current];
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => saveSessions(snapshot)).catch(() => setMessage('Übungen konnten nicht gespeichert werden. Bitte Speicherplatz und Berechtigungen prüfen.'));
  }, [ready, media?.key, loops, speed, offset, project?.path]);
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
  function syncMediaMetadata() {
    const video=player.current;if(!video)return;
    const d=video.duration;
    if(!Number.isFinite(d)||d<=0)return;
    setDuration(d);video.playbackRate=speed;video.volume=volume;video.preservesPitch=true;
    if(pendingSeek.current!==null&&video.readyState>=1){video.currentTime=Math.min(pendingSeek.current,d);setTime(video.currentTime);pendingSeek.current=null;}
  }
  function deleteLoop(id:string) {
    if(selectedLoopId===id || loops.length===1){
      restoreGeneration.current++;setRestoring(false);setSelectedLoopId(null);
      setLooping(false);setA(null);setB(null);materialEditable.current=true;
    }
    setLoops(old=>old.filter(loop=>loop.id!==id));syncMediaMetadata();
  }
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
    if (!loopValid || savingLoop) return;
    setSavingLoop(true);
    if (loops.length >= 500) { setSavingLoop(false);setMessage('Für diese Datei sind bereits 500 Loops gespeichert.'); return; }
    const id=crypto.randomUUID(),generation=restoreGeneration.current;
    try {
      const materialId=await saveMaterial({version:1,analysis:analysis&&samePassage(a,b,analysis.start,analysis.end)?analysis:null,score:scoreDocument?serializeScore(scoreDocument):null,scoreState,tabDraft:selectedLoop?tabDraft:undefined,analysisTrack:track,offset},project?.path);
      if(generation!==restoreGeneration.current)return;
      setLoops(old=>[...old,{id,name:loopName.trim() || `Passage ${old.length+1}`,start:a!,end:b!,materialId,rhythm:{bpm:null,beatsPerBar:4,beatUnit:4,bars:null}}]);
      materialEditable.current=true;setSelectedLoopId(id);setLoopName('');
    }catch(e){setMessage(`Loop konnte nicht gespeichert werden: ${e}`);}finally{setSavingLoop(false);}
  }
  // Keep large notes/GP data outside sessions.json; each loop stores a content ID.
  useEffect(()=>{
    const saved=loopsRef.current.find(l=>l.id===selectedLoopId);
    if(project || !materialEditable.current || !saved || restoring || !samePassage(a,b,saved.start,saved.end))return;
    const generation=fileGeneration.current, revision=++materialRevision.current;
    const material:LoopMaterial={version:1,analysis:analysis&&samePassage(a,b,analysis.start,analysis.end)?analysis:null,score:scoreDocument?serializeScore(scoreDocument):null,scoreState,tabDraft:selectedLoop?tabDraft:undefined,analysisTrack:track,offset};
    materialRevisions.current.set(saved.id,revision);
    const pending=saveMaterial(material);pendingMaterials.current.set(saved.id,pending);
    void pending.then(materialId=>{
      if(generation!==fileGeneration.current || materialRevisions.current.get(saved.id)!==revision)return;
      setLoops(old=>old.map(l=>l.id===saved.id&&samePassage(l.start,l.end,saved.start,saved.end)?{...l,materialId}:l));
    }).catch(e=>{if(generation===fileGeneration.current)setMessage(`Notendaten konnten nicht gespeichert werden: ${e}`);})
      .finally(()=>{if(pendingMaterials.current.get(saved.id)===pending)pendingMaterials.current.delete(saved.id);});
  },[selectedLoopId,restoring,a,b,analysis,scoreDocument,scoreState,tabDraft,track,offset]);

  async function chooseLoop(loop:Loop) {
    const request=++restoreGeneration.current;materialEditable.current=false;midiGeneration.current++;setBusy(false);
    setSelectedLoopId(loop.id);setRestoring(true);setA(loop.start);setB(loop.end);setLooping(true);seek(loop.start);
    setAnalysis(null);setTabDraft({clips:[]});setNoteSource('score');setNotes([]);setTracks([]);setTrack(-1);setMidiName('');setScoreDocument(null);setScoreState(null);
    setMessage('Gespeicherte Spuren und Noten werden geladen …');
    try {
      const materialId=await (pendingMaterials.current.get(loop.id)??projectHeads.current.get(loop.id)) || loop.materialId;
      workspaceId.current=materialId??null;
      if(request!==restoreGeneration.current)return;
      let material=materialId?await loadMaterial(materialId,project?.path):null;
      if(request!==restoreGeneration.current)return;
      if(!material && media && !project){
        let source=media.nativePath;
        if(!source&&media.blob&&isTauri())source=await invoke<string>('stage_media',await media.blob.arrayBuffer());
        if(request!==restoreGeneration.current)return;
        const cached=source?await findCachedAnalysis(source,loop.start,loop.end):null;
        if(cached)material={version:1,analysis:cached,score:null,scoreState:null,analysisTrack:cached.stems.find(s=>s.source==='guitar')?.id??cached.stems[0].id,offset:cached.start};
      }
      if(request!==restoreGeneration.current)return;
      if(material){
        setOffset(material.offset);setScoreState(material.scoreState);setTabDraft(material.tabDraft??{clips:[]});
        if(material.score){const restored=await ensureGp7(restoreScore(material.score));if(request!==restoreGeneration.current)return;setScoreDocument(restored);setScoreVersion(v=>v+1);}
        if(material.analysis){setAnalysis(material.analysis);if(!material.score)showStem(material.analysis,material.analysisTrack,false);else setTrack(material.analysisTrack);if(!material.score&&material.analysis.stems.some(s=>s.notes.length)){const restored=await analysisScore(material.analysis,loop.rhythm);if(request!==restoreGeneration.current)return;setScoreDocument(restored);}setOffset(material.offset);}
        setMessage(material.analysis||material.score?'Gespeicherte Spuren und Noten wiederhergestellt.':'Loop geladen. Für diese Passage sind noch keine Notendaten gespeichert.');
      }else setMessage('Für diese Passage sind noch keine Spuren oder Notendateien gespeichert.');
      materialEditable.current=true;
    }catch(e){if(request===restoreGeneration.current)setMessage(`Gespeicherte Notendaten konnten nicht geladen werden: ${e}`);}
    finally{if(request===restoreGeneration.current)setRestoring(false);}
  }
  async function acceptAnalysis(result:AnalysisResult){
    const range=currentRange.current;
    if(!samePassage(range.a,range.b,result.start,result.end))return;
    materialEditable.current=true;
    const saved=loopsRef.current.find(l=>l.id===selectedLoopId&&samePassage(range.a,range.b,l.start,l.end)) || loopsRef.current.find(l=>samePassage(range.a,range.b,l.start,l.end));
    if(saved)setSelectedLoopId(saved.id);
    setAnalysis(result);
    const chosen=result.stems.find(s=>s.source==='guitar'&&s.notes.length)||result.stems.find(s=>s.notes.length)||result.stems[0];
    showStem(result,chosen.id,false);
    const generation=++midiGeneration.current;setScoreDocument(null);setScoreState(null);setBusy(true);
    if(!result.stems.some(s=>s.notes.length)){setBusy(false);return;}
    try{const doc=await analysisScore(result);if(generation!==midiGeneration.current||!samePassage(currentRange.current.a,currentRange.current.b,result.start,result.end))return;setScoreDocument(doc);setScoreVersion(v=>v+1);setScoreState({track:Math.max(0,doc.origin?.trackIds?.indexOf(chosen.id)??0),start:0,end:doc.duration,speed:1,loop:true,alignment:{scoreStart:0,scoreEnd:result.end-result.start,mediaStart:result.start,mediaEnd:result.end}});}
    catch(e){setMessage(`Die Analyse bleibt gespeichert; die Partitur konnte nicht erstellt werden: ${e}`);}
    finally{if(generation===midiGeneration.current)setBusy(false);}
  }
  async function analysisScore(result:AnalysisResult, rhythm=selectedLoop?.rhythm){
    return ensureGp7({id:crypto.randomUUID(),name:`Loop ${formatTime(result.start)}–${formatTime(result.end)}`,notes:result.stems.flatMap(s=>s.notes),tracks:result.stems.map(s=>({id:s.id,name:s.name,count:s.notes.length})),duration:result.end-result.start,bpm:rhythm?.bpm??120,meter:rhythm?{numerator:rhythm.beatsPerBar,denominator:rhythm.beatUnit}:undefined,origin:{kind:'analysis',start:result.start,end:result.end}});
  }
  useEffect(()=>{
    if(!media || media.demo)return;
    const controller=new AbortController();let active=true;
    setWaveState('Wellenform wird gelesen …');
    void readWaveform(media.blob??media.url,controller.signal).then(value=>{
      if(active){setPeaks(value);setWaveState('');}
    }).catch(error=>{if(active)setWaveState(`Wellenform nicht verfügbar: ${String(error?.message??error)}`);});
    return()=>{active=false;controller.abort();};
  },[media,sourceVersion]);
  async function loadFile(file: File) {
    if(hasOpenEditor())return;
    if (/\.(mid|midi|gp3|gp4|gp5|gpx|gp)$/i.test(file.name)) { await loadMidi(file); return; }
    if(project){setMessage('Für eine andere Aufnahme bitte ein neues Projekt anlegen. MIDI / Guitar Pro kannst du weiterhin zu diesem Projekt laden.');return;}
    const kind = file.type.startsWith('video') || /\.(mp4|webm|mov|mkv|m4v)$/i.test(file.name) ? 'video' : 'audio';
    if (!file.type.startsWith('audio') && !file.type.startsWith('video') && !/\.(mp3|wav|flac|ogg|m4a|aac|mp4|webm|mov|mkv|m4v)$/i.test(file.name)) { setMessage('Bitte eine Audio-, Video-, MIDI- oder Guitar-Pro-Datei auswählen.'); return; }
    fileGeneration.current++;
    setSource({ key: `${file.name}:${file.size}:${file.lastModified}`, name: file.name, url: URL.createObjectURL(file), blob: file, kind });

  }
  async function chooseMedia() {
    if(project){showProjects();return;}
    if (!isTauri()) { mediaInput.current?.click(); return; }
    try {
      const path = await open({ multiple: false, directory: false, filters: [{ name: 'Musik & Video', extensions: ['mp3','wav','flac','ogg','m4a','aac','mp4','webm','mov','mkv'] }] });
      if (!path) return;
      fileGeneration.current++;
      const name = path.split(/[\\/]/).pop() || path;
      const kind = /\.(mp4|webm|mov|mkv)$/i.test(name) ? 'video' : 'audio';
      setSource({ key: path, name, url: convertFileSrc(path), kind, nativePath: path });

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
      materialEditable.current=true;
      const doc=await ensureGp7({ ...parsed, id: crypto.randomUUID(), name: file.name, gp: /\.(gp3|gp4|gp5|gpx|gp)$/i.test(file.name) ? buffer : undefined, midi: /\.(mid|midi)$/i.test(file.name) ? buffer : undefined });
      if(generation===midiGeneration.current){setScoreState(null);setScoreVersion(v=>v+1);setScoreDocument(doc);}
    } catch (error) { if (generation === midiGeneration.current) setMessage(error instanceof Error ? error.message : 'Die Notendatei konnte nicht gelesen werden.'); }
    finally { if (generation === midiGeneration.current) setBusy(false); }
  }

  async function resizeLoopToScore(document:ScoreDocument,useFirstBeat:boolean){
    if(!selectedLoop||restoring||projectTransition.current)throw new Error('Bitte den gespeicherten Loop erneut auswählen.');
    const loop=selectedLoop,request=restoreGeneration.current;
    const next=await ensureGp7({...document,id:crypto.randomUUID()});
    if(request!==restoreGeneration.current||!samePassage(currentRange.current.a,currentRange.current.b,loop.start,loop.end))throw new Error('Der gewählte Loop hat sich geändert.');
    const resized=loopForScore(loop,next,duration,useFirstBeat);
    player.current?.pause();restoreGeneration.current++;midiGeneration.current++;
    materialRevisions.current.set(loop.id,++materialRevision.current);materialEditable.current=true;
    flushSync(()=>{
      setLoops(old=>old.map(item=>item.id===loop.id?resized:item));setA(resized.start);setB(resized.end);setLooping(true);setPlaying(false);
      setTabDraft(old=>({...old,previousScore:scoreDocument?serializeScore(scoreDocument):old.previousScore}));
      setScoreDocument(next);setScoreVersion(v=>v+1);setTrack(next.tracks[0]?.id??-1);setOffset(resized.start);
      setAnalysis(analysisForRange(analysis,resized.start,resized.end));
      setScoreState({track:next.tracks[0]?.id??-1,start:0,end:next.duration,speed:1,loop:true,alignment:{scoreStart:0,scoreEnd:next.duration,mediaStart:resized.start,mediaEnd:resized.end}});
    });
    seek(resized.start);await storageFlushRef.current();
    setMessage(`Loop und Partitur sind auf ${next.duration.toFixed(3)} s abgestimmt. A: ${resized.start.toFixed(3)} s · B: ${resized.end.toFixed(3)} s. Im Notenplayer „Aufnahme folgen“ aktivieren.`);
  }
  async function applyTabScore(document:ScoreDocument,align:boolean){
    if(!selectedLoop||restoring||projectTransition.current)throw new Error('Bitte den gespeicherten Loop erneut auswählen.');
    const request=restoreGeneration.current, loop=selectedLoop;
    const next=await ensureGp7({...document,id:crypto.randomUUID()});
    if(request!==restoreGeneration.current||!samePassage(currentRange.current.a,currentRange.current.b,loop.start,loop.end))throw new Error('Der gewählte Loop hat sich geändert.');
    if(align&&!loopScoreFit(next,loop).canAlign)throw new Error('Taktumfang und Loop-Daten zuerst prüfen.');
    materialEditable.current=true;
    flushSync(()=>{setTabDraft(old=>({...old,previousScore:scoreDocument?serializeScore(scoreDocument):old.previousScore}));setScoreDocument(next);setScoreVersion(v=>v+1);setOffset(loop.start);setTrack(next.tracks[0]?.id??-1);setScoreState({track:next.tracks[0]?.id??-1,start:0,end:next.duration,speed:1,loop:true,alignment:align?{scoreStart:0,scoreEnd:next.duration,mediaStart:loop.start,mediaEnd:loop.end}:null});});
    await storageFlushRef.current();
  }
  async function commitScore(next:ScoreDocument){
    const state=scoreDocument?reconcileScoreState(scoreDocument,next,scoreState):scoreState;
    flushSync(()=>{setScoreDocument(next);setScoreState(state);if(scoreState?.alignment&&!state?.alignment)setMessage('Die Notenlänge oder der Rhythmus hat sich geändert. Bitte die Notenpassage erneut mit der Aufnahme verknüpfen.');});
    await storageFlushRef.current();
    if(!project&&!selectedLoopId)setMessage('Partitur übernommen. Speichere eine A/B-Passage, um sie dauerhaft einem Loop zuzuordnen.');
  }
  function showStem(result: AnalysisResult, id: number, useScore=true) {
    if(useScore&&scoreDocument?.gpFormat==='gp7'&&scoreDocument.origin?.kind==='analysis'&&samePassage(result.start,result.end,scoreDocument.origin.start!,scoreDocument.origin.end!)){
      const mapped=scoreDocument.origin.trackIds?.indexOf(id)??id;
      if(mapped<0){setMessage('Für diese Instrumentenspur enthält die Partitur keine Tonnoten.');return;}
      setTrack(mapped);setOffset(result.start);setNoteSource('analysis');return;
    }
    setNotes(result.stems.flatMap(stem => stem.notes));
    setTracks(result.stems.map(stem => ({ id: stem.id, name: stem.name, count: stem.notes.length })));
    setTrack(id); setOffset(result.start); setNoteSource('analysis');
    setMidiName(`Analyse · ${formatTime(result.start)} – ${formatTime(result.end)}`);
  }

  async function flushSession() {
    await flushOpenEditor();
    await storageFlushRef.current();
  }
  async function flushStorage() {
    const forced=persistProject(true);
    if(!project)await Promise.all([...pendingMaterials.current.values()]);
    await saveQueue.current;
    await (forced??projectQueue.current);
  }
  storageFlushRef.current=flushStorage;
  flushRef.current=flushSession;
  async function refreshProjects() {
    try { setRecentProjects(await listProjects()); } catch(e) { setProjectError(String(e)); }
  }
  function showProjects() {
    setCreateCurrent(0);
    player.current?.pause();setPlaying(false);setDragging(false);setArea('projects');
    void refreshProjects();
  }
  async function applyProject(loaded:OpenProject) {
    projectLoading.current=true;
    fileGeneration.current++;projectHeads.current.clear();pendingMaterials.current.clear();materialRevisions.current.clear();
    setProject(loaded);workspaceId.current=loaded.snapshot.workspace.materialId;
    setSource({key:'project:'+loaded.path,name:loaded.snapshot.media.name,kind:loaded.snapshot.media.kind,url:convertFileSrc(loaded.mediaPath),nativePath:loaded.mediaPath},loaded.snapshot.session);
    const w=loaded.snapshot.workspace;
    setA(w.a);setB(w.b);setLooping(w.looping);setView(w.view);setVolume(w.volume);setSelectedLoopId(w.selectedLoopId);
    pendingSeek.current=w.a??0;setRestoring(true);
    let restored=true;
    try {
      if(w.materialId){
        materialEditable.current=false;
        const material=await loadMaterial(w.materialId,loaded.path);
        if(material.score){const restored=await ensureGp7(restoreScore(material.score));setScoreDocument(restored);setScoreVersion(v=>v+1);}
        setScoreState(material.scoreState);setTabDraft(material.tabDraft??{clips:[]});
        if(material.analysis){setAnalysis(material.analysis);if(!material.score)showStem(material.analysis,material.analysisTrack,false);else setTrack(material.analysisTrack);if(!material.score&&material.analysis.stems.some(s=>s.notes.length))setScoreDocument(await analysisScore(material.analysis));}
        setOffset(material.offset);materialEditable.current=true;
      }
      setMessage(loaded.warnings.length?loaded.warnings.join('\n'):'Projekt geöffnet. Aufnahme, Loops und Noten sind wiederhergestellt.');
    } catch(e) {restored=false;setMessage(`Projekt geöffnet, aber der letzte Notenstand konnte nicht geladen werden: ${e}`);}
    finally {setRestoring(false);projectLoading.current=false;setProjectSaveState(restored?'Gespeichert':'Notendaten prüfen – automatisches Speichern angehalten');setArea('studio');}
  }
  async function selectProject(path:string) {
    if(!ready || projectTransition.current || savingLoop || busy || restoring)return;
    projectTransition.current=true;player.current?.pause();setPlaying(false);setProjectBusy('Aktuelle Session wird gespeichert …');setProjectError('');
    try {await flushSession();setProjectBusy('Projekt wird geöffnet …');const loaded=await openProject(path);await applyProject(loaded);await refreshProjects();}
    catch(e){setProjectError(String(e));}
    finally{projectTransition.current=false;setProjectBusy('');}
  }
  async function newProject(input:NewProject) {
    if(!ready || projectTransition.current || savingLoop || busy || restoring)return;
    projectTransition.current=true;player.current?.pause();setPlaying(false);setProjectError('');setProjectBusy('Projekt wird vorbereitet …');
    let unlisten:(()=>void)|undefined;
    try {
      const pending=[...pendingMaterials.current.entries()];
      await flushSession();
      const completed=new Map(await Promise.all(pending.map(async([id,promise])=>[id,await promise] as const)));
      let initial:Session={key:input.source,loops:[],speed:1,offset:0},workspace=emptyWorkspace();
      if(input.inheritCurrent){
        if(project || !media)throw new Error('Bitte zuerst eine Aufnahme ohne Projekt öffnen.');
        let source=media.nativePath;
        if(!source&&media.blob){
          if(media.blob.size>512*1024*1024){
            setProjectBusy('Bitte die ursprüngliche Aufnahme für dieses Projekt auswählen …');
            const original=await open({title:'Originaldatei der aktuellen Aufnahme auswählen',multiple:false,filters:[{name:'Audio / Video',extensions:['mp3','wav','flac','ogg','m4a','aac','opus','mp4','mkv','webm','mov','m4v']}]});
            if(typeof original!=='string')return;
            source=original;
          }else source=await invoke<string>('stage_media',await media.blob.arrayBuffer());
        }
        if(!source)throw new Error('Die Aufnahme fehlt.');
        input={...input,source,mediaName:media.demo?media.name+'.wav':media.name};
        initial={key:media.key,loops:loopsRef.current.map(l=>({...l,materialId:completed.get(l.id)??l.materialId})),speed,offset};
        const projectScore=scoreDocument??(media.demo?{id:crypto.randomUUID(),name:'Demo-Noten',notes,tracks,duration,bpm:100}:null);
        const materialId=await saveMaterial({version:1,analysis,score:projectScore?serializeScore(projectScore):null,scoreState,tabDraft:selectedLoop?tabDraft:undefined,analysisTrack:track,offset});
        workspace={materialId,selectedLoopId:initial.loops.some(l=>l.id===selectedLoopId)?selectedLoopId:null,a,b,looping,view,volume};
      } else {
        const previous=store.current.find(s=>s.key.replaceAll('\\','/').toLowerCase()===input.source.replaceAll('\\','/').toLowerCase());
        if(previous)initial={...previous,loops:previous.loops.map(l=>({...l,materialId:completed.get(l.id)??l.materialId}))};
      }
      unlisten=await listen<{percent:number;message:string}>('project-progress',e=>setProjectBusy(`${e.payload.message} ${Math.floor(e.payload.percent)} %`));
      const loaded=await createProject(input,initial,workspace);await applyProject(loaded);await refreshProjects();
    }catch(e){setProjectError(String(e));}
    finally{unlisten?.();projectTransition.current=false;setProjectBusy('');}
  }
  function persistProject(force=false):Promise<void>|undefined {
    if(!project || !ready || restoring || projectLoading.current || (projectTransition.current&&!force) || !materialEditable.current)return;
    const path=project.path,generation=fileGeneration.current,revision=++projectRevision.current;
    const value:LoopMaterial={version:1,analysis,score:scoreDocument?serializeScore(scoreDocument):null,scoreState,tabDraft:selectedLoop?tabDraft:undefined,analysisTrack:track,offset};
    const saved=loops.find(l=>l.id===selectedLoopId&&samePassage(a,b,l.start,l.end));
    const draft=saveMaterial(value,path);
    const matchingAnalysis=analysis&&samePassage(a,b,analysis.start,analysis.end)?analysis:null;
    const attachment=saved?(matchingAnalysis===analysis?draft:saveMaterial({...value,analysis:matchingAnalysis},path)):null;
    if(saved&&attachment){pendingMaterials.current.set(saved.id,attachment);projectHeads.current.stage(saved.id,{...value,analysis:matchingAnalysis},attachment);}
    // Attach rejection handlers immediately, even while an earlier disk write is queued.
    const prepared=Promise.all([draft,projectHeads.current.resolve(loops,data=>saveMaterial(data,path))]);void prepared.catch(()=>{});
    setProjectSaveState('Wird gespeichert …');
    const task=projectQueue.current.catch(()=>{}).then(async()=>{
      const [materialId,snapshotLoops]=await prepared;
      await saveProject(path,{key:'project',loops:snapshotLoops,speed,offset},{materialId,selectedLoopId:snapshotLoops.some(l=>l.id===selectedLoopId)?selectedLoopId:null,a,b,looping,view,volume});
      if(generation!==fileGeneration.current || projectRef.current?.path!==path)return;
      workspaceId.current=materialId;
      if(revision===projectRevision.current){
        setProjectSaveState('Gespeichert');
        const ids=new Map(snapshotLoops.map(l=>[l.id,l.materialId]));
        setLoops(old=>old.some(l=>ids.has(l.id)&&ids.get(l.id)!==l.materialId)?old.map(l=>ids.has(l.id)?{...l,materialId:ids.get(l.id)}:l):old);
      }
    });
    projectQueue.current=task;
    void task.catch(e=>{if(generation===fileGeneration.current&&projectRef.current?.path===path){setProjectSaveState('Speichern fehlgeschlagen');setMessage(`Projekt konnte nicht gespeichert werden: ${e}`);}}).finally(()=>{if(saved&&pendingMaterials.current.get(saved.id)===attachment)pendingMaterials.current.delete(saved.id);});
    return task;
  }
  useEffect(()=>{void persistProject();},[project?.path,ready,restoring,loops,speed,offset,a,b,looping,view,volume,selectedLoopId,analysis,scoreDocument,scoreState,tabDraft,track,saveAttempt]);
  useEffect(()=>{
    if(!isTauri())return;
    let disposed=false,unlisten:(()=>void)|undefined;
    const win=getCurrentWindow();
    void win.onCloseRequested(closeAfterSaving({
      transition:projectTransition,hasProject:()=>!!projectRef.current||hasOpenEditor(),flush:()=>flushRef.current(),onBusy:setProjectBusy,
      onError:e=>{setProjectError(String(e));setMessage(`Das Projekt konnte vor dem Schließen nicht gespeichert werden: ${e}`);}
    })).then(stop=>{if(disposed)stop();else unlisten=stop;}).catch(e=>setProjectError(String(e)));
    return()=>{disposed=true;unlisten?.();};
  },[]);

  return <div className="app" onDragOver={event => { event.preventDefault();if(area!=='studio')return; setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { event.preventDefault();if(area!=='studio')return; setDragging(false); const file = event.dataTransfer.files[0]; if (file) void loadFile(file); }}>
    <input ref={mediaInput} type="file" accept="audio/*,video/*,.mid,.midi,.gp3,.gp4,.gp5,.gpx,.gp" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.target.value = ''; }}/>
    <input ref={midiInput} type="file" accept=".mid,.midi,.gp3,.gp4,.gp5,.gpx,.gp" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void loadMidi(file); event.target.value = ''; }}/>
    <nav className="area-mobile" aria-label="Arbeitsbereich"><button onClick={showProjects}>Projekte</button><button onClick={()=>setArea('studio')}>Übungsraum</button><button onClick={()=>{player.current?.pause();setArea('tools');}}>Tab-Werkzeuge</button><button onClick={showSettings}>Einstellungen</button></nav>
      <aside className="sidebar">
      <div className="brand"><span className="brand-icon"><Activity size={22}/></span>Loop<span>Studio</span></div>
      <div className="sidebar-caption">DEIN ÜBUNGSRAUM</div>
      <button className={area==='projects'?'nav-active':'nav-button'} title="Projekte" onClick={showProjects}><FolderOpen size={17}/> Projekte {area==='projects'&&<span className="nav-dot"/>}</button>
      <button className={area==='studio'?'nav-active':'nav-button'} title="Übungsraum" onClick={()=>setArea('studio')}><SlidersHorizontal size={17}/> Übungsraum {area==='studio'&&<span className="nav-dot"/>}</button>
      <button className={area==='tools'?'nav-active':'nav-button'} title="Tab-Werkzeuge" onClick={()=>{player.current?.pause();setPlaying(false);setDragging(false);setArea('tools');}}><Music2 size={17}/> Tab-Werkzeuge {area==='tools'&&<span className="nav-dot"/>}</button>
      <button className={area==='settings'?'nav-active':'nav-button'} title="Globale Einstellungen" onClick={showSettings}><SlidersHorizontal size={17}/> Globale Einstellungen {area==='settings'&&<span className="nav-dot"/>}</button>
      <div style={{display:area==='studio'?undefined:'none'}}>
      <button className="nav-button" onClick={() => void chooseMedia()}><FolderOpen size={17}/> {project?'Projekt wechseln':'Datei öffnen'} <Plus size={15}/></button>
      <div className="sidebar-caption section-gap">AKTUELLE SESSION</div>
      <div className="current-file"><span className="file-icon"><Music2 size={18}/></span><div><strong>{media?.name || 'Keine Datei'}</strong><small>{media?.demo ? 'Demo · C / Am / F / G' : media?.kind === 'video' ? 'Lokales Musikvideo' : media?.midiOnly ? 'Notendatei · synthetische Wiedergabe' : 'Lokale Audiodatei'}</small></div></div>
      <div className="sidebar-caption section-gap">GESPEICHERTE LOOPS <span>{loops.length.toString().padStart(2, '0')}</span></div>
      <div className="saved-loops">{loops.length === 0 ? <div className="empty-loops"><Repeat2 size={22}/><p>Eine gute Passage?<br/>Setze A und B und speichere sie hier.</p></div> : loops.map(loop => <div className="saved-loop" key={loop.id}><button onClick={() => void chooseLoop(loop)}><Repeat2 size={15}/><span><strong>{loop.name}</strong><small>{formatTime(loop.start)} – {formatTime(loop.end)}</small></span></button><button className="delete" title={`Loop ${loop.name} löschen`} onClick={() => deleteLoop(loop.id)}><Trash2 size={13}/></button></div>)}</div>
      </div>
      <div className="sidebar-bottom"><div className="local-badge"><span/> Lokal auf deinem Gerät</div><button className="nav-button" onClick={() => setHelp(true)}><HelpCircle size={16}/> Hilfe & Tastenkürzel</button><small>LoopStudio <span>0.8.0 · Local Studio</span></small></div>
    </aside>
    {area==='projects'&&<ProjectHome projects={recentProjects} legacy={store.current} busy={!ready?'Projekte werden geladen …':projectBusy || (savingLoop?'Loop wird gespeichert …':busy?'Notendatei wird geladen …':restoring?'Noten werden wiederhergestellt …':'')} error={projectError} current={!project&&media?{path:media.nativePath||'(aktuelle Aufnahme im Studio)',name:media.name}:undefined} createCurrent={createCurrent} onOpen={path=>void selectProject(path)} onCreate={input=>void newProject(input)} onDemo={()=>void loadDemo()} onRefresh={()=>void refreshProjects()}/>}
    {area==='settings'&&(globalSettingsReady||globalSettingsError?<GlobalSettingsPanel settings={globalSettings} loadError={globalSettingsError} onSave={async settings=>{await saveGlobalSettings(settings);setGlobalSettings(settings);setGlobalSettingsReady(true);setGlobalSettingsError('');}}/>:<main><div className="workspace"><p role="status">Einstellungen werden geladen …</p></div></main>)}
    <main style={{display:area==='studio'?undefined:'none'}}>
      <header className="topbar"><div className="breadcrumb">Arbeitsplatz <span>/</span> <strong>Studio</strong></div><div className="header-actions"><span className="privacy"><span/> LOKAL AUF DEINEM PC</span><button className="button light" onClick={() => void chooseMedia()}><Plus size={16}/> {project?'Projekt wechseln':'Datei öffnen'}</button></div></header>
      <div className="workspace">
        <section className="heading"><div><div className="eyebrow">WENIGER SUCHEN. MEHR SPIELEN.</div><h1>{project?.snapshot.name || 'Deine nächste gute Wiederholung.'}</h1><p>{project?'Dein Projekt mit Aufnahme, Loops und Noten.':'Hör genau hin. Finde deine Passage. Mach sie zu deiner.'}</p></div><button className="button subtle" onClick={loadDemo}><Headphones size={16}/> Demo laden</button></section>
        {project&&<div className="project-save-bar"><span role="status">{projectSaveState}</span><span title={project.path}>{project.path}</span><button className="button subtle small" onClick={()=>setSaveAttempt(v=>v+1)}>Jetzt speichern</button></div>}
        {!project&&media&&<div className="project-save-bar"><span>Diese Session als vollständiges Projekt aufbewahren</span><button className="button subtle" onClick={()=>{showProjects();setCreateCurrent(Date.now());}}>Als Projekt speichern</button></div>}
        {message && <div className="notice" role="alert">{message}<button title="Hinweis schließen" onClick={() => setMessage('')}><X size={16}/></button></div>}
        <section className="player-card">
          <div className="card-heading"><div><span className="tiny-dot"/> PLAYER <span className="tag">{media?.kind === 'video' ? 'VIDEO' : 'AUDIO'}</span></div><span className="muted">{media?.demo ? 'Original-Demo · 100 BPM' : 'Datei bleibt auf deinem Gerät'}</span></div>
          <div className={`media-stage ${media?.kind === 'video' ? 'video-mode' : ''}`}>
            <video key={sourceVersion} ref={player} src={media?.url} playsInline preload="metadata" onLoadedMetadata={syncMediaMetadata} onDurationChange={syncMediaMetadata} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={() => { if (player.current?.paused) setTime(player.current.currentTime); }} onEnded={() => { if (looping && loopValid) { seek(a!); void player.current?.play(); } else setPlaying(false); }} onError={() => { if (media) setMessage('Dieses Medienformat konnte nicht geöffnet werden. MP3/WAV und MP4 mit H.264/AAC sind gute Ausgangsformate.'); }}/>
            {media?.kind !== 'video' && <><div className={`record-art ${playing ? 'spinning' : ''}`}><div className="record-label"><Activity size={28}/></div></div><div className="track-info"><div className="eyebrow">{media?.demo ? 'DEIN ERSTER DURCHLAUF' : 'JETZT IM STUDIO'}</div><h2>{media?.name || 'Öffne deine Musik'}</h2><p>{media?.demo ? 'Eine kleine Akkordfolge. Viel Platz zum Üben.' : midiName ? 'Audio und Noten gemeinsam im Blick.' : 'Analysiere eine Passage oder lade MIDI / Guitar Pro dazu.'}</p><div className="track-tags"><span><FileAudio size={12}/> {media?.midiOnly ? 'Noten-Synthese' : 'Lokale Wiedergabe'}</span><span>{duration ? formatTime(duration) : '—'}</span></div></div><div className="sound-lines" aria-hidden="true">{[24,42,30,62,48,76,38,56,29].map((h,i) => <i key={i} style={{height:h,animationDelay:`${i*0.1}s`,animationPlayState:playing?'running':'paused'}}/>)}</div></>}
          </div>
          <Timeline key={sourceVersion} peaks={peaks} duration={duration} time={time} a={a} b={b} looping={looping} waveState={waveState} disabled={restoring||!!projectBusy} onSeek={seek} onRange={range=>{restoreGeneration.current++;setSelectedLoopId(null);setA(range.a);setB(range.b);if(!validLoop(range.a,range.b,duration))setLooping(false);}}/>
          <div className="transport"><div className="playback"><button className="icon-button" title="5 Sekunden zurück (←)" onClick={() => seek(time-5)}><ArrowLeft size={18}/><small>5</small></button><button className="play-button" title={playing?'Pause (Leertaste)':'Abspielen (Leertaste)'} disabled={!duration} onClick={() => void togglePlay()}>{playing?<Pause size={21} fill="currentColor"/>:<Play size={21} fill="currentColor"/>}</button><button className="icon-button" title="5 Sekunden vor (→)" onClick={() => seek(time+5)}><small>5</small><ArrowRight size={18}/></button><span className="transport-divider"/><button className={`icon-button ${looping?'selected':''}`} title="Loop umschalten (L)" disabled={!loopValid} onClick={() => setLooping(!looping)}><Repeat2 size={20}/></button></div><div className="tempo"><span>Tempo</span><select aria-label="Wiedergabegeschwindigkeit" value={speed} onChange={event => setSpeed(+event.target.value)}>{[0.25,0.5,0.6,0.7,0.75,0.8,0.9,1,1.1,1.25,1.5,2].map(rate => <option key={rate} value={rate}>{Math.round(rate*100)} %</option>)}</select><span className="pitch-preserved">Tonhöhe bleibt</span></div><div className="volume"><Volume2 size={18}/><input type="range" aria-label="Lautstärke" min="0" max="1" step="0.01" value={volume} onChange={event => setVolume(+event.target.value)}/></div></div>
          <div className="loop-bar"><span className="loop-label"><Repeat2 size={15}/> Passage loopen</span><button className={`marker-button ${a!==null?'set':''}`} onClick={markA} disabled={!duration}><kbd>A</kbd> {a!==null?formatTime(a):'Start setzen'}</button><span className="muted">→</span><button className={`marker-button ${b!==null?'set':''}`} onClick={markB} disabled={!duration}><kbd>B</kbd> {b!==null?formatTime(b):'Ende setzen'}</button><button className="icon-button" title="Loop zurücksetzen" disabled={a===null&&b===null} onClick={() => {setA(null);setB(null);setLooping(false);}}><X size={15}/></button><div className="save-loop"><input aria-label="Name des Loops" placeholder="Passage benennen …" maxLength={100} value={loopName} onChange={event => setLoopName(event.target.value)} onKeyDown={event => {if(event.key==='Enter')saveLoop();}}/><button className="button subtle small" disabled={!loopValid||savingLoop} onClick={saveLoop}><Save size={14}/> Speichern</button></div></div>
        </section>
        {media && <AnalysisPanel settings={globalSettings} settingsReady={globalSettingsReady} onSettings={showSettings} key={sourceVersion} player={player} nativePath={media.nativePath} blob={media.blob} start={a} end={b} valid={loopValid} volume={volume} result={analysis} selected={noteSource === 'analysis' ? (scoreDocument?.origin?.trackIds?.[track]??track) : null} onResult={acceptAnalysis} onSelect={id => { if (analysis) showStem(analysis, id); }}/>}
        {selectedLoop&&<LoopRhythmPanel key={selectedLoop.id} loop={selectedLoop} source={media?.nativePath} blob={media?.blob} document={scoreDocument} onChange={rhythm=>updateLoopRhythm(rhythm)}/>}
        {scoreDocument ? <ScoreStudio key={`${scoreDocument.id}:${scoreVersion}`} active={area==='studio'&&!projectTransition.current} initialState={scoreState} initialView={view==='edit'?'notation':view} onViewChange={setView} selectedTrack={track} onTrackChange={setTrack} onStateChange={setScoreState} onChange={commitScore} editRequest={editRequest} document={scoreDocument} media={player} mediaKey={media?.key || ""} a={a} b={b} onLoad={() => midiInput.current?.click()}/> : <section className="instrument-card"><div className="instrument-toolbar"><strong>LOOP-PARTITUR</strong><button className="button subtle" onClick={()=>midiInput.current?.click()}>MIDI / Guitar Pro laden</button></div><p className="analysis-hint score-description">Wähle einen Loop und analysiere die Passage oder lade eine Notendatei. Die Partitur erscheint hier mit Noten, Griffbrett und Piano Waterfall.</p></section>}
        {selectedLoop&&media?.kind==='video'&&!restoring&&<LoopTabTool onResize={resizeLoopToScore} mediaDuration={duration} activeDocument={scoreDocument} key={`${sourceVersion}:${selectedLoop.id}`} active={area==='studio'} loop={selectedLoop} source={media.nativePath} blob={media.blob} player={player} draft={tabDraft} onDraft={setTabDraft} onApply={applyTabScore}/>}
        <footer className="workspace-footer"><span><Check size={14}/> {project?'Projekt wird automatisch gespeichert. Alle Dateien bleiben lokal.':'Dateien bleiben lokal. Loops werden automatisch gespeichert.'}</span><button onClick={() => setHelp(true)}>Tastenkürzel <kbd>?</kbd></button></footer>
      </div>
    </main>
    <div className="tab-tools-host" style={{display:area==='tools'?undefined:'none'}}><TabTools active={area==='tools'} onImport={document=>{midiGeneration.current++;restoreGeneration.current++;setRestoring(false);setBusy(false);materialEditable.current=true;player.current?.pause();setPlaying(false);setScoreDocument(document);setScoreState(null);setScoreVersion(v=>v+1);setArea('studio');setMessage('Notenfassung aus den Tab-Werkzeugen geöffnet. Zum Hinterlegen beim Loop die Passage speichern oder einen gespeicherten Loop verwenden.');}}/></div>
    {projectBusy&&<div className="project-operation"><section role="status" aria-live="polite"><LoaderCircle size={28} className="spinner"/><h2>Dein Projekt wird vorbereitet.</h2><p>{projectBusy}</p></section></div>}
    {dragging&&<div className="drop-overlay"><FolderOpen size={42}/><h2>Deine Musik. Dein Tempo.</h2><p>Audio, Video, MIDI oder Guitar Pro hier ablegen</p></div>}
    {help&&<div className="modal-backdrop" onClick={() => setHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-label="Hilfe" onClick={event => event.stopPropagation()}><button autoFocus className="close-modal icon-button" onClick={() => setHelp(false)} title="Hilfe schließen"><X size={20}/></button><div className="eyebrow">DEIN SCHNELLSTART</div><h2>Ein Loop. Ein bisschen besser.</h2><p>Öffne eine lokale Audio- oder Videodatei. Setze beim Hören den Anfang mit A und das Ende mit B. Die Passage wiederholt sich, bis du den Loop ausschaltest.</p><dl><dt>Abspielen / Pause</dt><dd>Leertaste</dd><dt>Loop-Anfang / Ende</dt><dd>A / B</dd><dt>Loop an / aus</dt><dd>L</dd><dt>5 Sekunden springen</dt><dd>← / →</dd></dl><h3>Noten sichtbar machen</h3><p>Analysiere eine A/B-Passage bis 3 Minuten, um sechs Instrumentenspuren und erkannte Noten zu erhalten. Klicke im Mixer auf ein Instrument; seine Noten folgen dem Player. Mit M/S und den Reglern hörst du einzelne Spuren. Außerhalb der analysierten Passage läuft das Original. Alternativ: MIDI oder Guitar Pro (auch GP5) laden und die angezeigte Spur auswählen. „Notenstart in Aufnahme“ richtet die Noten zur Aufnahme aus. Der eigene Notenplayer spielt MIDI und Guitar Pro unabhängig von der Aufnahme. Wähle in beiden Playern eine Passage, verknüpfe sie und aktiviere „Aufnahme folgen“. Die Zuordnung passt Position und Tempo an. Im Notenplayer steuert die Spurauswahl auch den Syntheseklang.</p><p>Das Griffbrett zeigt gespeicherte Guitar-Pro-Positionen oder eine KI-gestützte Griffzuordnung pro Note. Wähle dafür eine einzelne Spur. Zusätzliche Gitarrenstimmen sind separat auswählbar. H entspricht dem internationalen B. Die Demo enthält bereits passende Noten.</p><div className="help-note">Demucs trennt Gitarre, Piano, Bass, Schlagzeug, Gesang und weitere Instrumente. Basic Pitch schätzt die Tonhöhen. Ergebnisse sind keine fehlerfreien Transkriptionen; besonders Piano und leise Instrumente können unvollständig sein. Schlagzeug erhält keine Klaviernoten. Unterstützte Medienformate hängen von Windows/WebView2 ab.</div><p className="muted">Es wird nichts hochgeladen. Analysen und importierte Dateien aus Drag & Drop liegen im lokalen App-Cache. Für dieselbe Datei und Passage werden vorhandene Analysen wiederverwendet. Beim Start ein Projekt öffnen: Aufnahme, Loops und Noten werden gemeinsam wiederhergestellt. Für ältere Sessions kann die Aufnahme weiterhin erneut geöffnet oder als Projekt übernommen werden.</p></section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
