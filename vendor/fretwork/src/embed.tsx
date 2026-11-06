import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AlphaTabApi, LayoutMode, StaveProfile, synth, model } from '@coderline/alphatab';
import { store } from './editor/store';
import { useStore } from './ui/hooks/useStore';
import { SelectionOverlay } from './ui/SelectionOverlay';
import { EffectsPanel } from './ui/EffectsPanel';
import { selectByBeat, selectByNote, resolveBeat } from './editor/selection';
import { resolveNote } from './editor/ScoreMutator';
import { attachKeyboard } from './input/keyboard';
import { clearHistory, execute, undo, redo } from './editor/HistoryRouter';
import { setSelectedDuration, setSelectedFret, deleteSelectedNote, insertBeatAfterSelection, toggleSelectedDot } from './editor/commands';
import { syncSoundFont } from './editor/soundfont';
import { exportGp7Bytes } from './persistence/export';
import './embed.css';

const token = new URLSearchParams(location.search).get('session');
const send = (type: string, extra: Record<string, unknown> = {}) => parent.postMessage({channel:'loopstudio-fretwork',token,type,...extra}, location.origin);

function Editor() {
  const host=useRef<HTMLDivElement>(null), scroll=useRef<HTMLDivElement>(null);
  const [loaded,setLoaded]=useState(false), [error,setError]=useState(''),[track,setTrack]=useState(0),[selectedNote,setSelectedNote]=useState<model.Note|null>(null);
  const state=useStore(s=>s),api=state.api;
  const beat=api?.score&&state.selection?resolveBeat(api.score,state.selection):null;
  const staff=beat?.voice.bar.staff??api?.score?.tracks[track]?.staves[0];
  const fretted=!!staff?.isStringed;
  const note=fretted&&api?.score&&state.selection?resolveNote(api.score,state.selection,state.selectedString):selectedNote?.beat===beat?selectedNote:beat?.notes[0]??null;

  useEffect(()=>{
    if(!host.current||!scroll.current)return;
    const instance=new AlphaTabApi(host.current,{
      core:{fontDirectory:'/fretwork/font/',includeNoteBounds:true},
      display:{layoutMode:LayoutMode.Horizontal,scale:1},
      player:{enablePlayer:true,enableCursor:true,enableUserInteraction:false,scrollElement:scroll.current},
    });
    store.setState({api:instance,currentFileId:'loop',view:{zoom:1,layoutMode:'horizontal'}});
    instance.error.on(e=>{setError(e.message);send('error',{message:e.message});});
    instance.scoreLoaded.on(score=>{
      clearHistory();store.setState({selection:null,anchor:null,tracks:score.tracks.map(t=>({index:t.index,name:t.name,rendered:true,muted:false,soloed:false}))});
      setSelectedNote(null);setLoaded(true);send('loaded');
    });
    instance.midiLoaded.on(()=>void syncSoundFont());
    instance.playerStateChanged.on(e=>store.setState({transport:{...store.getState().transport,playing:e.state===synth.PlayerState.Playing}}));
    instance.beatMouseDown.on(b=>{selectByBeat(b);const selected=b.notes.find(n=>n.string===store.getState().selectedString)??b.notes[0];if(selected){selectByNote(selected);setSelectedNote(selected);}else setSelectedNote(null);});
    instance.noteMouseDown.on(n=>{selectByNote(n);setSelectedNote(n);});
    const stopKeyboard=attachKeyboard();
    const stopChanges=store.subscribe(s=>s.scoreVersion,()=>send('changed'));
    const receive=(e:MessageEvent)=>{
      const m=e.data;
      if(e.source!==parent||e.origin!==location.origin||m?.channel!=='loopstudio-fretwork'||m.token!==token)return;
      try {
        if(m.type==='load'&&m.bytes instanceof ArrayBuffer){
          const chosen=Number.isInteger(m.track)&&m.track>=0?m.track:0;setTrack(chosen);
          instance.load(new Uint8Array(m.bytes),[chosen]);
        }
        if(m.type==='unlock')document.getElementById('app')!.inert=false;
        if(m.type==='snapshot'){
          document.getElementById('app')!.inert=true;
          instance.pause();
          if(!instance.score)throw new Error('Die Partitur ist noch nicht geladen.');
          send('snapshot',{request:m.request,bytes:exportGp7Bytes(instance.score,instance.settings).slice().buffer});
        }
      }catch(err){send('error',{request:m.request,message:String(err)});}
    };
    window.addEventListener('message',receive);send('ready');
    return()=>{stopChanges();stopKeyboard();window.removeEventListener('message',receive);clearHistory();instance.destroy();store.setState({api:null});};
  },[]);

  function chooseTrack(index:number){
    if(!api?.score)return;
    api.pause();api.renderTracks([api.score.tracks[index]]);
    api.changeTrackMute(api.score.tracks,true);api.changeTrackMute([api.score.tracks[index]],false);
    store.setState({selection:null,anchor:null});setSelectedNote(null);setTrack(index);
  }
  // Pitched instruments need a pitch control: upstream fret entry only addresses stringed notes.
  function pitch(value:number){
    if(!note||note.isStringed||!Number.isInteger(value)||value<0||value>127)return;
    const target=note,octave=target.octave,tone=target.tone;
    execute({describe:()=> 'Tonhöhe ändern',apply:()=>{target.octave=Math.floor(value/12);target.tone=value%12;},undo:()=>{target.octave=octave;target.tone=tone;}});
  }
  function remove(){
    if(fretted){deleteSelectedNote();return;}
    if(!note)return;
    const target=note,owner=note.beat,index=owner.notes.indexOf(target);
    execute({relayout:'voice',describe:()=> 'Note löschen',apply:()=>{owner.notes.splice(owner.notes.indexOf(target),1);},undo:()=>{owner.notes.splice(index,0,target);}});
  }
  return <div className="editor">
    <header><button disabled={!loaded} onClick={()=>{api?.loadMidiForScore();api?.playPause();}}>Anhören</button><button disabled={!loaded} onClick={()=>api?.stop()}>Stopp</button>
      <label>Spur <select aria-label="Editor-Spur" value={track} onChange={e=>chooseTrack(+e.currentTarget.value)}>{state.tracks.map(t=><option value={t.index}>{t.name}</option>)}</select></label>
      <button disabled={!state.canUndo} onClick={undo}>Rückgängig</button><button disabled={!state.canRedo} onClick={redo}>Wiederholen</button>
      <label>Anzeige <select aria-label="Notendarstellung" onChange={e=>{if(api){api.settings.display.staveProfile=+e.currentTarget.value;api.updateSettings();api.render();}}}><option value={StaveProfile.Default}>Noten + Tabulatur</option><option value={StaveProfile.Tab}>Tabulatur</option><option value={StaveProfile.Score}>Noten</option></select></label>
    </header>
    <div className="basic">
      {fretted?<><label>Saite <select aria-label="Saite" disabled={!beat} value={state.selectedString} onChange={e=>store.setState({selectedString:+e.currentTarget.value})}>{staff?.tuning.map((_,i)=><option value={staff.tuning.length-i}>{i+1}</option>)}</select></label>
      <label>Bund <input aria-label="Bund" type="number" min="0" max="24" style={{width:65}} disabled={!beat} value={note?.fret??''} onInput={e=>setSelectedFret(+e.currentTarget.value)}/></label></>:<label>Tonhöhe (MIDI) <input aria-label="Tonhöhe" style={{width:70}} type="number" min="0" max="127" disabled={!note} value={note?note.realValue:''} onInput={e=>pitch(+e.currentTarget.value)}/></label>}
      <label>Notenwert <select aria-label="Notenwert" disabled={!beat} value={beat?.duration??4} onChange={e=>setSelectedDuration(+e.currentTarget.value)}>{[1,2,4,8,16,32,64].map(n=><option value={n}>1/{n}</option>)}</select></label>
      <button disabled={!beat} onClick={toggleSelectedDot}>Punktierung</button><button disabled={!beat} onClick={insertBeatAfterSelection}>Pause danach</button><button disabled={!note} onClick={remove}>Note löschen</button>
    </div>
    <p className="hint">Note anklicken und oben ändern. Bei Gitarren: Ziffern = Bund · Pfeile = Auswahl · Strg+Z = rückgängig. Änderungen mit „Übernehmen“ im Loop speichern.</p>
    {fretted&&<details className="advanced"><summary>Spieltechniken und Takte</summary><EffectsPanel/></details>}
    {(error||state.warning)&&<div className="error" role="alert">{error||state.warning}</div>}
    <div className="sheet" ref={scroll}><div className="paper"><div ref={host}/><SelectionOverlay/></div></div>
  </div>;
}
render(<Editor/>,document.getElementById('app')!);
