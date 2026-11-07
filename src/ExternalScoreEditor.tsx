import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { ScoreDocument } from './ScoreStudio';
import { exportExternalScore, gpHash, prepareExternalImport } from './externalScore';

export function ExternalScoreEditor({document:doc,context,project,active,disabled,onChange,onPause,onBusyChange}:{
  document:ScoreDocument;context:string;project?:string;active:boolean;disabled:boolean;
  onChange:(document:ScoreDocument)=>Promise<void>|void;onPause:()=>void;onBusyChange:(busy:boolean)=>void;
}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[path,setPath]=useState('');
  const [retry,setRetry]=useState(false);
  const alive=useRef(true),flight=useRef(false),pending=useRef<ScoreDocument|null>(null);
  const pendingBase=useRef<ArrayBuffer|undefined>(undefined);
  const current=useRef({doc,context,project,active,onChange,onPause,onBusyChange});
  current.current={doc,context,project,active,onChange,onPause,onBusyChange};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;current.current.onBusyChange(false);};},[]);
  const edit=doc.externalEdit?.context===context?doc.externalEdit:undefined;
  function setWorking(value:boolean){flight.current=value;if(alive.current){setBusy(value);current.current.onBusyChange(value);}}
  async function chooseProgram(){
    const selected=await open({title:'GuitarPro.exe auswählen',multiple:false,filters:[{name:'Guitar Pro',extensions:['exe']}]});
    if(typeof selected!=='string')return false;
    await invoke('set_guitar_pro_path',{path:selected});return true;
  }
  async function configure(){
    if(flight.current)return;setWorking(true);setError('');
    try{if(await chooseProgram())setMessage('Guitar Pro ist eingerichtet.');}catch(e){if(alive.current)setError(String(e));}finally{setWorking(false);}
  }
  async function launch(forceNew=false){
    if(flight.current)return;
    const owner=current.current;
    const isCurrent=()=>alive.current&&current.current.active&&current.current.doc===owner.doc&&current.current.context===owner.context&&current.current.project===owner.project;
    setWorking(true);setError('');setMessage('Partitur wird für Guitar Pro vorbereitet …');owner.onPause();
    try{
      if(!await invoke<string|null>('guitar_pro_path')&&!await chooseProgram()){if(alive.current)setMessage('Keine Anwendung ausgewählt.');return;}
      if(!isCurrent())throw new Error('Der Loop oder die Partitur wurde gewechselt.');
      let bound=owner.doc;
      const existing=bound.externalEdit?.context===owner.context?bound.externalEdit:undefined;
      const reuse=!forceNew&&existing&&bound.gp&&!bound.edited&&await gpHash(bound.gp)===existing.baselineHash;
      if(!isCurrent())throw new Error('Der Loop oder die Partitur wurde gewechselt.');
      if(!reuse){
        const exported=await exportExternalScore(bound,owner.context,owner.project,isCurrent);
        bound=exported.document;
      }
      // Retry a previously failed save even when reusing an existing working copy.
      await owner.onChange(bound);
      if(!alive.current||current.current.context!==owner.context||current.current.project!==owner.project||!current.current.active)throw new Error('Der Loop oder die Partitur wurde gewechselt.');
      const working=await invoke<string>('launch_external_score',{project:owner.project??null,sessionId:bound.externalEdit!.sessionId,documentId:bound.id,context:owner.context});
      if(alive.current){setPath(working);setMessage('In Guitar Pro bearbeiten und mit Strg+S speichern. Danach hier „Änderungen übernehmen“ wählen.');}
    }catch(e){if(alive.current){setError(String(e));setMessage('');}}
    finally{setWorking(false);}
  }
  async function accept(){
    if(flight.current)return;
    const owner=current.current;
    const isCurrent=()=>alive.current&&current.current.active&&current.current.doc===owner.doc&&current.current.context===owner.context&&current.current.project===owner.project;
    setWorking(true);setError('');setMessage('Externe Partitur wird geprüft …');owner.onPause();
    try{
      if(!pending.current){
        const imported=await prepareExternalImport(owner.doc,owner.context,owner.project,isCurrent);
        setPath(imported.path);
        if(!imported.document){setMessage('Die Datei ist unverändert. Änderungen bitte zuerst in Guitar Pro mit Strg+S speichern.');return;}
        pendingBase.current=owner.doc.gp;pending.current=imported.document;setRetry(true);
      }else if(pending.current.id!==owner.doc.id||(owner.doc.gp!==pending.current.gp&&owner.doc.gp!==pendingBase.current)){
        throw new Error('Die Partitur hat sich geändert. Bitte den aktuellen Notenstand zuerst speichern.');
      }
      if(!isCurrent())throw new Error('Der Loop oder die Partitur wurde gewechselt.');
      await owner.onChange(pending.current);
      pending.current=null;pendingBase.current=undefined;setRetry(false);
      if(alive.current)setMessage('Änderungen übernommen. Die vorherige Notenfassung ist im history-Ordner neben der Arbeitskopie gesichert. Bei geändertem Rhythmus die Synchronisierung erneut prüfen.');
    }catch(e){if(alive.current){setError(String(e));setMessage(pending.current?'Die Übernahme wurde noch nicht dauerhaft gespeichert. Bitte erneut speichern.':'');}}
    finally{setWorking(false);}
  }
  if(!isTauri())return null;
  return <div className="external-score-editor">
    <div className="score-controls">
      <button className="button subtle" disabled={disabled||busy||retry||!active} onClick={()=>void launch()}>In Guitar Pro bearbeiten</button>
      {edit&&<button className="button subtle small" disabled={disabled||busy||retry||!active} onClick={()=>void launch(true)}>Neue Arbeitskopie</button>}
      {edit&&<button className="button light" disabled={disabled||busy||!active} onClick={()=>void accept()}>{retry?'Übernahme erneut speichern':'Änderungen aus Guitar Pro übernehmen'}</button>}
      <button className="button subtle small" disabled={disabled||busy||!active} onClick={()=>void configure()}>Guitar Pro auswählen …</button>
    </div>
    {path&&<p className="analysis-hint score-description" style={{overflowWrap:'anywhere'}}>Arbeitskopie: {path}</p>}
    {message&&<p className="analysis-hint score-description" role="status">{message}</p>}
    {error&&<p className="analysis-error" role="alert">{error}</p>}
  </div>;
}
