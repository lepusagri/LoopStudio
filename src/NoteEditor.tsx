import { useEffect, useMemo, useState } from 'react';
import { editedNote, replaceNote, type NoteDraft } from './noteEditing';
import { formatTime, isActive, noteName, tuning, type Note } from './music';

type Props={notes:Note[];track:number;duration:number;time:number;onChange:(notes:Note[])=>void;onSeek?:(time:number)=>void};
export function NoteEditor({notes,track,duration,time,onChange,onSeek}:Props) {
  const [selected,setSelected]=useState<number|null>(null),[page,setPage]=useState(0),[error,setError]=useState('');
  const [past,setPast]=useState<Note[][]>([]),[future,setFuture]=useState<Note[][]>([]);
  const [draft,setDraft]=useState<NoteDraft>({midi:64,time:0,duration:.25,velocity:.8});
  const rows=useMemo(()=>notes.map((note,index)=>({note,index})).filter(r=>r.note.track===track),[notes,track]);
  const firstPosition=rows.find(r=>r.note.position)?.note.position;
  const currentPosition=selected===null?firstPosition:notes[selected]?.position || firstPosition;
  const strings=currentPosition?.tuning || tuning, capo=currentPosition?.capo || 0;
  const pages=Math.max(1,Math.ceil(rows.length/40)),currentPage=Math.min(page,pages-1);
  useEffect(()=>{setSelected(null);setPage(0);setError('');},[track]);
  function pick(index:number) {
    const n=notes[index];setSelected(index);setError('');
    setDraft({midi:n.midi,time:n.time,duration:n.duration,velocity:n.velocity,string:n.position?.string,fret:n.position?.fret});
  }
  function commit(next:Note[]) {setPast(h=>[...h.slice(-29),notes]);setFuture([]);onChange(next);setSelected(null);setError('');}
  function apply() {
    try {
      if(selected===null) {
        const base:Note={midi:draft.midi,time:draft.time,duration:draft.duration,velocity:draft.velocity,track};
        commit([...notes,editedNote(base,draft,duration,strings,capo)].sort((a,b)=>a.time-b.time||a.midi-b.midi));
      } else commit(replaceNote(notes,selected,draft,duration,strings,capo));
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  }
  if(track<0)return <p className="analysis-hint score-description">Zum Bearbeiten eine einzelne Notenspur auswählen.</p>;
  return <section className="note-editor" aria-label="Noten bearbeiten">
    <div className="score-controls"><button className="button subtle small" disabled={!past.length} onClick={()=>{const previous=past[past.length-1];setPast(past.slice(0,-1));setFuture(h=>[notes,...h]);onChange(previous);setSelected(null);}}>Rückgängig</button><button className="button subtle small" disabled={!future.length} onClick={()=>{setPast(h=>[...h,notes]);onChange(future[0]);setFuture(future.slice(1));setSelected(null);}}>Wiederholen</button><button className="button subtle small" onClick={()=>{setSelected(null);setDraft({midi:64,time:Math.max(0,Math.min(time,duration-.25)),duration:Math.min(.25,duration),velocity:.8});setError('');}}>Neue Note</button><span>{rows.length} Noten · Änderungen werden mit dem gespeicherten Loop gesichert.</span></div>
    <form className="score-controls note-edit-form" onSubmit={e=>{e.preventDefault();apply();}}>
      <strong>{selected===null?'Neue Note':`Note ${selected+1}`}</strong>
      <label>Tonhöhe (MIDI) <input aria-label="Tonhöhe MIDI" type="number" min="0" max="127" step="1" value={draft.midi} onChange={e=>{const midi=+e.target.value;const fret=draft.string===undefined?undefined:midi-strings[draft.string]-capo;setDraft({...draft,midi,string:fret!==undefined&&fret>=0&&fret<=36?draft.string:undefined,fret});}}/></label><span>{noteName(draft.midi,true)}</span>
      <label>Anfang (s) <input aria-label="Notenanfang" type="number" min="0" max={duration} step=".01" value={draft.time} onChange={e=>setDraft({...draft,time:+e.target.value})}/></label>
      <label>Dauer (s) <input aria-label="Notendauer" type="number" min=".01" max={duration} step=".01" value={draft.duration} onChange={e=>setDraft({...draft,duration:+e.target.value})}/></label>
      <label>Lautstärke (%) <input aria-label="Notenanschlag" type="number" min="0" max="100" step="1" value={Math.round(draft.velocity*100)} onChange={e=>setDraft({...draft,velocity:+e.target.value/100})}/></label>
      <label>Saite <select aria-label="Saite" value={draft.string??''} onChange={e=>{if(e.target.value===''){setDraft({...draft,string:undefined,fret:undefined});return;}const string=+e.target.value,fret=Math.max(0,Math.min(36,draft.midi-strings[string]-capo));setDraft({...draft,string,fret,midi:strings[string]+capo+fret});}}><option value="">Keine feste Position</option>{strings.map((pitch,i)=><option key={i} value={i}>{i+1} · {noteName(pitch+capo,true)}</option>)}</select></label>
      <label>Bund <input aria-label="Bund" type="number" disabled={draft.string===undefined} min="0" max="36" step="1" value={draft.fret??0} onChange={e=>{const fret=+e.target.value;setDraft({...draft,fret,midi:strings[draft.string!]+capo+fret});}}/></label>
      <button className="button light small" type="submit">{selected===null?'Note hinzufügen':'Änderung übernehmen'}</button>
      {selected!==null&&<button type="button" className="button subtle small" onClick={()=>commit(notes.filter((_,i)=>i!==selected))}>Note löschen</button>}
    </form>
    {error&&<p className="analysis-error" role="alert">{error}</p>}
    <div className="note-table"><table><thead><tr><th>Note</th><th>Anfang</th><th>Dauer</th><th>Ton</th><th>Saite / Bund</th><th/></tr></thead><tbody>{rows.slice(currentPage*40,(currentPage+1)*40).map(({note,index},i)=><tr key={index} className={selected===index?'selected':isActive(note,time)?'sounding':''}><td><button className="button subtle small" onClick={()=>pick(index)} aria-label={`Note ${currentPage*40+i+1} auswählen`}>{currentPage*40+i+1}</button></td><td>{formatTime(note.time)}</td><td>{note.duration.toFixed(3)} s</td><td>{noteName(note.midi,true)} · {note.midi}</td><td>{note.position?`${note.position.string+1} / ${note.position.fret}`:'—'}</td><td>{onSeek&&<button className="button subtle small" onClick={()=>onSeek(note.time)}>Hierhin</button>}</td></tr>)}</tbody></table></div>
    <div className="score-controls"><button className="button subtle small" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Zurück</button><span>Seite {currentPage+1} / {pages}</span><button className="button subtle small" disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>Weiter</button></div>
  </section>;
}
