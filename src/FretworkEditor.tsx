import { useEffect, useRef, useState } from 'react';
import type { ScoreDocument } from './ScoreStudio';
import { ensureGp7, updatedGp7 } from './gp7Document';
import { registerEditorFlush } from './editorSession';

export function FretworkEditor({document:doc,track,onSave,onClose}:{document:ScoreDocument;track:number;onSave:(doc:ScoreDocument)=>Promise<void>|void;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),frame=useRef<HTMLIFrameElement>(null),token=useRef(crypto.randomUUID());
  const [error,setError]=useState(''),[status,setStatus]=useState('Partitur wird vorbereitet …'),[ready,setReady]=useState(false),[saving,setSaving]=useState(false),[dirty,setDirty]=useState(false);
  const saveRef=useRef(onSave);saveRef.current=onSave;
  const closeRef=useRef(onClose);closeRef.current=onClose;
  const commitRef=useRef<()=>Promise<void>>(async()=>{throw new Error('Die Partitur wird noch vorbereitet.');});
  useEffect(()=>{
    dialog.current?.showModal();
    let disposed=false,childReady=false,loaded=false,canonical:ScoreDocument|null=null,flight:Promise<void>|null=null;
    let pending:{id:string;resolve:(b:ArrayBuffer)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}|null=null;
    const send=(type:string,extra:Record<string,unknown>={})=>frame.current?.contentWindow?.postMessage({channel:'loopstudio-fretwork',token:token.current,type,...extra},location.origin);
    const load=()=>{if(childReady&&canonical?.gp)send('load',{bytes:canonical.gp,track:canonical.origin?.trackIds&&doc.gpFormat!=='gp7'?Math.max(0,canonical.origin.trackIds.indexOf(track)):track});};
    const receive=(event:MessageEvent)=>{
      const m=event.data;
      if(event.source!==frame.current?.contentWindow||event.origin!==location.origin||m?.channel!=='loopstudio-fretwork'||m.token!==token.current)return;
      if(m.type==='ready'){childReady=true;load();}
      if(m.type==='loaded'){loaded=true;setReady(true);setStatus('Partitur bereit');}
      if(m.type==='changed'){setDirty(true);setStatus('Ungespeicherte Änderungen');}
      if(m.type==='error'){setError(String(m.message));if(pending&&m.request===pending.id){clearTimeout(pending.timer);pending.reject(new Error(String(m.message)));pending=null;}}
      if(m.type==='snapshot'&&pending&&m.request===pending.id&&m.bytes instanceof ArrayBuffer){clearTimeout(pending.timer);pending.resolve(m.bytes);pending=null;}
    };
    window.addEventListener('message',receive);
    void ensureGp7(doc).then(result=>{if(disposed)return;canonical=result;load();}).catch(e=>{if(!disposed){setError(String(e));setStatus('Partitur konnte nicht geöffnet werden');}});
    const commit=():Promise<void>=>{
      if(flight)return flight;
      if(!loaded||!canonical)return Promise.reject(new Error('Die Partitur ist noch nicht bereit. Bitte den Editor fertig laden lassen oder verwerfen.'));
      setSaving(true);setError('');setStatus('Partitur wird im Loop gespeichert …');
      flight=(async()=>{
        const bytes=await new Promise<ArrayBuffer>((resolve,reject)=>{
          const id=crypto.randomUUID(),timer=setTimeout(()=>{pending=null;reject(new Error('Der Editor antwortet nicht. Die Änderungen wurden nicht verworfen.'));},15000);
          pending={id,resolve,reject,timer};send('snapshot',{request:id});
        });
        const next=await updatedGp7(canonical!,bytes);
        await saveRef.current(next);
        canonical=next;if(!disposed){setDirty(false);setStatus('Gespeichert');}
      })().catch(e=>{if(!disposed){setError(String(e));setStatus('Speichern fehlgeschlagen – Editor bleibt geöffnet');}throw e;}).finally(()=>{flight=null;if(!disposed){send('unlock');setSaving(false);}});
      return flight;
    };
    commitRef.current=commit;
    const unregister=registerEditorFlush(commit);
    return()=>{disposed=true;unregister();window.removeEventListener('message',receive);if(pending){clearTimeout(pending.timer);pending.reject(new Error('Editor geschlossen.'));}dialog.current?.close();};
  },[doc.id]);
  return <dialog className="fretwork-dialog" ref={dialog} aria-label="Loop-Partitur bearbeiten" onCancel={e=>e.preventDefault()} onKeyDown={e=>e.stopPropagation()}>
    <div className="fretwork-heading"><div><strong>Loop-Partitur bearbeiten</strong><small>{doc.name} · {status}</small></div>
      <button className="button subtle" disabled={saving} onClick={()=>{if(!dirty||window.confirm('Änderungen an dieser Partitur verwerfen?'))onClose();}}>{dirty?'Verwerfen':'Schließen'}</button>
      <button className="button light" disabled={!ready||saving} onClick={()=>void commitRef.current().then(()=>closeRef.current()).catch(()=>{})}>{saving?'Wird gespeichert …':'Übernehmen & schließen'}</button>
    </div>
    {doc.conversionNote&&<p className="score-description">{doc.conversionNote}</p>}
    {error&&<p role="alert" className="notice">{error}</p>}
    <iframe ref={frame} title="Fretwork Noteneditor" src={`/fretwork/index.html?session=${token.current}`} allow="autoplay"/>
  </dialog>;
}
