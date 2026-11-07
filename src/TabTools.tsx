import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { parseGuitarPro } from './guitarPro';
import { ScoreStudio, type ScoreDocument, type ScorePlaybackState } from './ScoreStudio';

type Crop={x:number;y:number;width:number;height:number};
type Result={engine:string;filename:string;gp5:string;tokens:string;report:{notes?:number;measures?:number;bars?:number;warnings?:string[];[key:string]:unknown};jobId:string};
type Work={path:string;kind:string;name:string;result?:Result;document?:ScoreDocument;state?:ScorePlaybackState};
type Clip={id:string;path:string;time:number};
const full:Crop={x:0,y:0,width:1,height:1};
export function TabTools({onImport,active}:{active:boolean;onImport:(doc:ScoreDocument)=>void}){
 const [engine,setEngine]=useState<'pdf'|'omr'>('pdf'),[work,setWork]=useState<Partial<Record<'pdf'|'omr',Work>>>({});
 const [status,setStatus]=useState({pdf:false,omr:false,backend:'Rust',setupScript:'setup-tab-tools.ps1'}),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [bpm,setBpm]=useState(120),[video,setVideo]=useState(''),[time,setTime]=useState(30),[duration,setDuration]=useState(0),[frame,setFrame]=useState(''),[crop,setCrop]=useState<Crop>(full),[clips,setClips]=useState<Clip[]>([]);
 const [progress,setProgress]=useState(0);
 const input=useRef<HTMLInputElement>(null),job=useRef<string|null>(null),alive=useRef(true),generation=useRef(0),drag=useRef<{x:number;y:number}|null>(null);
 const noMedia=useRef<HTMLVideoElement|null>(null),videoPlayer=useRef<HTMLVideoElement|null>(null);
 const current=work[engine];
 const rememberState=useCallback((state:ScorePlaybackState)=>setWork(old=>old[engine]?{...old,[engine]:{...old[engine]!,state}}:old),[engine]);
 useEffect(()=>{alive.current=true;if(isTauri())void invoke<typeof status>('tab_tools_status').then(setStatus).catch(()=>{});return()=>{alive.current=false;generation.current++;if(job.current)void invoke('cancel_tab_tool',{jobId:job.current});};},[]);
 function changeEngine(next:'pdf'|'omr'){setEngine(next);setError('');setMessage('');}
 async function load(file:File){
  if(!isTauri()){setError('Die lokalen Tab-Werkzeuge sind in der Desktop-App verfügbar.');return;}
  setError('');try{if(file.size>40*1024*1024)throw new Error('Maximal 40 MB pro Datei.');const data=await invoke<{path:string;kind:string}>('stage_tab_input',await file.arrayBuffer());if(engine==='pdf')setClips([]);setWork(old=>({...old,[engine]:{...data,name:file.name}}));}catch(e){setError(String(e));}
 }
 async function chooseVideo(){try{const path=await open({multiple:false,filters:[{name:'Lokales Video',extensions:['mp4','mkv','webm','mov','m4v']}]});if(typeof path==='string'){setVideo(await invoke<string>('prepare_tab_video',{source:path}));setTime(0);setDuration(0);setFrame('');setCrop(full);}}catch(e){setError(String(e));}}
 function seek(value:number){const next=Math.max(0,Math.min(duration||86400,value));setTime(next);if(videoPlayer.current)videoPlayer.current.currentTime=next;setFrame('');}
 async function getFrame(){videoPlayer.current?.pause();setBusy(true);setError('');try{const path=await invoke<string>('extract_tab_frame',{source:video,time,crop:null});setFrame(path);setCrop(full);}catch(e){setError(String(e));}finally{setBusy(false);}}
 function coordinate(e:PointerEvent<HTMLImageElement>){const box=e.currentTarget.getBoundingClientRect();return{x:Math.min(1,Math.max(0,(e.clientX-box.left)/box.width)),y:Math.min(1,Math.max(0,(e.clientY-box.top)/box.height))};}
 async function useCrop(){setBusy(true);setError('');try{const path=await invoke<string>('extract_tab_frame',{source:video,time,crop});if(engine==='pdf'){if(clips.length>=8)throw new Error('Maximal acht Ausschnitte pro PDF.');setClips(old=>[...old,{id:crypto.randomUUID(),path,time}]);setWork(old=>({...old,pdf:undefined}));setMessage('Ausschnitt zur gemeinsamen PDF-Seite hinzugefügt.');}else{setWork(old=>({...old,[engine]:{path,kind:'png',name:`Videotab bei ${time.toFixed(2)} s`}}));setMessage('Bildausschnitt übernommen. Jetzt die Erkennung starten.');}}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function exportPdf(){try{const destination=await save({defaultPath:'Videotabs.pdf',filters:[{name:'PDF',extensions:['pdf']}]});if(destination){setBusy(true);await invoke('compose_tab_pdf',{sources:clips.map(item=>item.path),destination});setMessage('Zusammengesetztes PDF gespeichert.');}}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function run(){
  if(!current&&!(engine==='pdf'&&clips.length))return;
  const id=crypto.randomUUID(),token=++generation.current;job.current=id;setBusy(true);setError('');setProgress(0);setMessage('Werkzeug wird vorbereitet …');let unlisten:(()=>void)|undefined;
  try{
   unlisten=await listen<{jobId:string;message:string;percent:number}>('tab-tool-progress',e=>{if(alive.current&&e.payload.jobId===id){setMessage(e.payload.message);setProgress(e.payload.percent);}});
   const source=engine==='pdf'&&clips.length?await invoke<string>('compose_tab_pdf',{sources:clips.map(item=>item.path),destination:null}):current!.path;
   const result=await invoke<Result>('run_tab_tool',{source,engine,bpm,jobId:id});
   if(!alive.current||token!==generation.current)return;
   const bytes=Uint8Array.from(atob(result.gp5),c=>c.charCodeAt(0)).buffer,parsed=await parseGuitarPro(bytes);
   if(!alive.current||token!==generation.current)return;
   setWork(old=>({...old,[engine]:{...(current??{path:source,kind:'pdf',name:'Videotabs.pdf'}),path:source,kind:engine==='pdf'&&clips.length?'pdf':current?.kind??'pdf',result,document:{...parsed,id:crypto.randomUUID(),name:result.filename,gp:bytes},state:undefined}}));
   setMessage('Ergebnis bereit. Bitte gegen das Bild prüfen.');
  }catch(e){if(alive.current&&token===generation.current){setMessage('');setError(String(e));}}finally{unlisten?.();job.current=null;if(alive.current)setBusy(false);}
 }
 async function cancel(){if(job.current){generation.current++;await invoke('cancel_tab_tool',{jobId:job.current});setMessage('Erkennung wird abgebrochen …');}}
 async function exportResult(kind:'gp5'|'json'|'tokens'){
  if(!current?.result)return;
  try{const path=await save({defaultPath:kind==='gp5'?current.result.filename:`tab-ergebnis.${kind==='tokens'?'txt':'json'}`,filters:[{name:kind==='gp5'?'Guitar Pro 5':kind==='tokens'?'OMR-Rohdaten':'Prüfbericht',extensions:[kind==='tokens'?'txt':kind]}]});if(path)await invoke('save_tab_artifact',{jobId:current.result.jobId,kind,destination:path});}catch(e){setError(String(e));}
 }
 return <main className="tab-tools" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();e.stopPropagation();const file=e.dataTransfer.files[0];if(file&&!busy)void load(file);}}>
  <header className="topbar"><div className="breadcrumb">Werkzeuge <span>/</span> <strong>Tab-Erkennung</strong></div><span className="privacy">LOKALE DATEIEN · EIGENER ARBEITSBEREICH</span></header>
  <div className="workspace"><section className="heading"><div><div className="eyebrow">TABULATUREN AUS BILDERN</div><h1>Tab-Werkzeuge</h1><p>PDFs, Bilder und Videoeinblendungen erkennen, prüfen und als eigene Notenfassung weiterverwenden.</p></div></section>
   <div className="tool-cards"><button className={engine==='pdf'?'tool-card active':'tool-card'} disabled={busy} onClick={()=>changeEngine('pdf')}><strong>PDF-to-GP5</strong><span>PDF / Screenshot → Guitar Pro</span><small>Lokale OCR · Ergebnis immer prüfen</small></button><button className={engine==='omr'?'tool-card active':'tool-card'} disabled={busy} onClick={()=>changeEngine('omr')}><strong>Guitar Tab OMR</strong><span>Tabulaturzeile → erkannte Noten</span><small>Experimentelles Modell · einzelner Bildausschnitt</small></button></div>
   <section className="instrument-card tool-panel"><div className="instrument-toolbar"><strong>{engine==='pdf'?'PDF-to-GP5':'Guitar Tab OMR'}</strong><button className="button subtle" disabled={busy} onClick={()=>input.current?.click()}>{engine==='pdf'?'PDF / Bild auswählen':'Tab-Bild auswählen'}</button></div>
    <input hidden ref={input} type="file" accept={engine==='pdf'?'.pdf,.png,.jpg,.jpeg,.webp':'.png,.jpg,.jpeg,.webp'} onChange={e=>{const file=e.target.files?.[0];if(file)void load(file);e.target.value='';}}/>
    <div className="score-controls"><label>Tempo (BPM) <input aria-label="Werkzeugtempo" type="number" min="20" max="400" value={bpm} disabled={busy} onChange={e=>setBpm(+e.target.value)}/></label><span>{engine==='pdf'&&clips.length?`${clips.length} Ausschnitte auf einer PDF-Seite`:current?.name || 'Noch keine Datei ausgewählt'}</span><button className="button light" disabled={busy||(!current&&!(engine==='pdf'&&clips.length))||!status[engine]||(engine==='omr'&&current?.kind==='pdf')} onClick={()=>void run()}>Erkennung starten</button>{busy&&job.current&&<button className="button subtle" onClick={()=>void cancel()}>Abbrechen</button>}</div>
    {!status[engine]&&<p className="analysis-hint score-description">{isTauri()?`Optionale Werkzeug-Laufzeit fehlt. Einmal ${status.setupScript} ausführen.`:'Die Erkennung benötigt die lokale Desktop-App.'}</p>}
    <p className="analysis-hint score-description">{engine==='pdf'?'Liest PDFs und klare Tab-Bilder mit dem lokalen PDF-to-GP5-Konverter. Bei Bildern können Zahlen und Rhythmus falsch erkannt werden.':'Liest eine einzelne, klar ausgeschnittene Tabulaturzeile mit dem veröffentlichten Guitar-Tab-OMR-Modell. Ausgabe und Taktgrenzen unbedingt prüfen. Aktuell CPU; separate optionale Testlaufzeit.'}</p>
    {current&&current.kind!=='pdf'&&<img className="tool-input-preview" src={convertFileSrc(current.path)} alt="Eingabebild der Tab-Erkennung"/>}
   </section>
   <details className="instrument-card tool-panel" open><summary>Tabulatur aus einem lokalen Video ausschneiden</summary><div className="score-controls"><button className="button subtle" disabled={busy||!isTauri()} onClick={()=>void chooseVideo()}>Video auswählen</button><span className="tool-path">{video || 'Eigene Videoauswahl für die Tab-Werkzeuge'}</span></div>
    {video&&<><video className="tool-video" ref={videoPlayer} src={convertFileSrc(video)} controls preload="metadata" onLoadedMetadata={e=>setDuration(e.currentTarget.duration)} onTimeUpdate={e=>{setTime(e.currentTarget.currentTime);setFrame('');}}/><div className="tool-scrub"><button className="button subtle" disabled={busy} onClick={()=>seek(time-.1)}>−0,1 s</button><input aria-label="Videozeitstelle" type="range" min="0" max={duration||1} step=".04" value={Math.min(time,duration||1)} disabled={busy||!duration} onChange={e=>seek(+e.target.value)}/><button className="button subtle" disabled={busy} onClick={()=>seek(time+.1)}>+0,1 s</button><span>{time.toFixed(2)} s</span><button className="button light" disabled={busy} onClick={()=>void getFrame()}>Standbild übernehmen</button></div></>}
    {frame&&<><p className="analysis-hint score-description">Im Bild ein Rechteck um eine vollständige Tabulaturzeile ziehen. Angeschnittene Takte möglichst ausschließen.</p><div className="tool-frame"><img draggable={false} src={convertFileSrc(frame)} alt="Videobild für die Tab-Bereichsauswahl" onPointerDown={e=>{drag.current=coordinate(e);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag.current){const end=coordinate(e);setCrop({x:Math.min(drag.current.x,end.x),y:Math.min(drag.current.y,end.y),width:Math.max(.01,Math.abs(end.x-drag.current.x)),height:Math.max(.01,Math.abs(end.y-drag.current.y))});}}} onPointerCancel={()=>{drag.current=null;}} onPointerUp={()=>{drag.current=null;}}/><div className="tool-crop" style={{left:`${crop.x*100}%`,top:`${crop.y*100}%`,width:`${crop.width*100}%`,height:`${crop.height*100}%`}}/></div><div className="score-controls"><button className="button light" disabled={busy||(engine==='pdf'&&clips.length>=8)} onClick={()=>void useCrop()}>{engine==='pdf'?'Zur PDF-Seite hinzufügen':'Für Guitar Tab OMR übernehmen'}</button><button className="button subtle" onClick={()=>setCrop(full)}>Ganzes Bild</button></div></>}
    {engine==='pdf'&&clips.length>0&&<section className="tool-pages"><div className="score-controls"><strong>Ausschnitte von oben nach unten ({clips.length}/8)</strong><button className="button subtle" disabled={busy} onClick={()=>void exportPdf()}>PDF speichern</button></div><div className="tool-page-list">{clips.map((item,index)=><div className="tool-page" key={item.id}><img src={convertFileSrc(item.path)} alt={`Ausschnitt ${index+1}`}/><span>Ausschnitt {index+1} · {item.time.toFixed(2)} s</span><button className="button subtle" disabled={busy||index===0} onClick={()=>{setClips(old=>{const next=[...old];[next[index-1],next[index]]=[next[index],next[index-1]];return next;});setWork(old=>({...old,pdf:undefined}));}}>↑</button><button className="button subtle" disabled={busy||index===clips.length-1} onClick={()=>{setClips(old=>{const next=[...old];[next[index],next[index+1]]=[next[index+1],next[index]];return next;});setWork(old=>({...old,pdf:undefined}));}}>↓</button><button className="button subtle" disabled={busy} onClick={()=>{setClips(old=>old.filter(clip=>clip.id!==item.id));setWork(old=>({...old,pdf:undefined}));}}>Entfernen</button></div>)}</div></section>}
   </details>
   {message&&<div className="notice" role="status">{message}{busy&&<progress max="100" value={progress}/>}</div>}{error&&<p className="analysis-error" role="alert">{error}</p>}
   {current?.result&&<section className="instrument-card tool-panel"><div className="score-controls"><strong>Prüfen und weiterverwenden</strong><span>{current.result.report.notes ?? '—'} Einträge · {current.result.report.measures ?? current.result.report.bars ?? '—'} Takte</span><button className="button subtle" onClick={()=>void exportResult('gp5')}>Erkanntes GP5 speichern</button><button className="button subtle" onClick={()=>void exportResult('json')}>Prüfbericht speichern</button>{current.result.tokens&&<button className="button subtle" onClick={()=>void exportResult('tokens')}>OMR-Rohdaten speichern</button>}<button className="button light" disabled={!current.document} onClick={()=>{if(current.document)onImport({...current.document,id:crypto.randomUUID()});}}>Bearbeitete Fassung im Übungsraum öffnen</button></div>
    {current.result.report.warnings?.map((warning,i)=><p key={i} className="analysis-hint score-description">{warning}</p>)}
    <p className="analysis-hint score-description">Die GP5-Datei enthält das direkte Erkennungsergebnis. Korrekturen in der Vorschau werden beim ausdrücklichen Übernehmen als Loop-Fassung weitergegeben.</p>
    {current.result.tokens&&<details className="tool-raw"><summary>Erkannte OMR-Symbole ansehen</summary><pre>{current.result.tokens}</pre></details>}
   </section>}
   {current?.document&&<ScoreStudio loadLabel="Anderes PDF / Tab-Bild wählen" active={active} key={current.document.id} document={current.document} media={noMedia} mediaKey="tab-tools" a={null} b={null} onLoad={()=>input.current?.click()} initialState={current.state} onStateChange={rememberState} onChange={document=>setWork(old=>({...old,[engine]:{...old[engine]!,document}}))}/>}
   <p className="analysis-hint">Werkzeuge: <a href="https://github.com/F100Pilot/PDF-to-GP5" target="_blank" rel="noreferrer">PDF-to-GP5 (MIT)</a> · <a href="https://huggingface.co/kk9293/guitar-tab-omr" target="_blank" rel="noreferrer">Guitar Tab OMR (experimentell, Modelllizenz „other“)</a>. Modellgewichte werden separat lokal geladen.</p>
  </div>
 </main>;
}
