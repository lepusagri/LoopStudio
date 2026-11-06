import { tuning, type Note, type FretPosition } from './music';
export type NoteDraft = { midi: number; time: number; duration: number; velocity: number; string?: number; fret?: number };
export function editedNote(original: Note, draft: NoteDraft, duration: number, strings = original.position?.tuning || tuning, capo = original.position?.capo || 0): Note {
  if (![draft.midi,draft.time,draft.duration,draft.velocity].every(Number.isFinite) || !Number.isInteger(draft.midi) || draft.midi<0 || draft.midi>127 || draft.time<0 || draft.duration<.01 || draft.time+draft.duration>duration+.001 || draft.velocity<0 || draft.velocity>1) throw new Error('Tonhöhe 0–127, gültigen Anfang, Dauer ab 0,01 s und Lautstärke 0–100 % innerhalb der Notenpassage eingeben.');
  let position: FretPosition | undefined;
  if (draft.string !== undefined) {
    if (!Number.isInteger(draft.string) || draft.string<0 || draft.string>=strings.length || !Number.isInteger(draft.fret) || draft.fret!<0 || draft.fret!>36 || strings[draft.string]+capo+draft.fret! !== draft.midi) throw new Error('Saite, Bund und Tonhöhe passen nicht zusammen.');
    position={string:draft.string,fret:draft.fret!,tuning:[...strings],capo,voice:original.position?.voice || 1,source:'manual'};
  }
  return {...original,midi:draft.midi,time:draft.time,duration:draft.duration,velocity:draft.velocity,position};
}
export function replaceNote(notes: Note[], index: number, draft: NoteDraft, duration: number, strings?: number[], capo?: number) {
  if (!notes[index]) throw new Error('Die gewählte Note fehlt.');
  const result=[...notes];result[index]=editedNote(notes[index],draft,duration,strings,capo);
  return result.sort((a,b)=>a.time-b.time || a.midi-b.midi);
}
export function recountTracks<T extends {id:number;count:number}>(tracks:T[],notes:Note[]):T[] {
  return tracks.map(t=>({...t,count:notes.filter(n=>n.track===t.id).length}));
}
