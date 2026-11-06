import { exporter, type model, type Settings } from '@coderline/alphatab';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

/** AlphaTab 1.9 assigns guitar fingerings even to piano staves on export.
 * Keep explicitly unstringed staves unstringed. Patch only XML just produced by
 * this exporter, never user-provided XML; all other GP assets remain unchanged. */
export function exportGp7(score:model.Score,settings:Settings):Uint8Array {
  const pitched=new Map<number,Set<number>>(),notes=new Map<number,{note:model.Note;fret:number;string:number;octave:number;tone:number}>();
  for(const track of score.tracks)for(const staff of track.staves){
    if(staff.isPercussion||staff.tuning.length)continue;
    const staves=pitched.get(track.index)??new Set<number>();staves.add(staff.index);pitched.set(track.index,staves);
    for(const bar of staff.bars)for(const voice of bar.voices)for(const beat of voice.beats)for(const note of beat.notes)notes.set(note.id,{note,fret:note.fret,string:note.string,octave:note.octave,tone:note.tone});
  }
  let bytes:Uint8Array;
  try{bytes=new exporter.Gp7Exporter().export(score,settings);}
  finally{for(const saved of notes.values()){saved.note.fret=saved.fret;saved.note.string=saved.string;}}
  if(!pitched.size)return bytes;
  const files=unzipSync(bytes),key='Content/score.gpif';
  if(!files[key])throw new Error('Der GP7-Export enthält keine Partitur.');
  let xml=strFromU8(files[key]);
  xml=xml.replace(/<Track id="(\d+)"[^>]*>[\s\S]*?<\/Track>/g,(block,id:string)=>{
    const staves=pitched.get(+id);if(!staves)return block;
    let index=0;
    return block.replace(/<Staff>[\s\S]*?<\/Staff>/g,staff=>staves.has(index++)?staff.replace(/<Property name="Tuning">[\s\S]*?<\/Property>/g,''):staff);
  });
  xml=xml.replace(/<Note id="(\d+)"[^>]*>[\s\S]*?<\/Note>/g,(block,id:string)=>notes.has(+id)?block.replace(/<Property name="(?:String|Fret|Octave|Tone)">[\s\S]*?<\/Property>/g,'').replace('</Properties>',`<Property name="Octave"><Number>${notes.get(+id)!.octave}</Number></Property><Property name="Tone"><Step>${notes.get(+id)!.tone}</Step></Property></Properties>`):block);
  files[key]=strToU8(xml);
  return zipSync(files);
}
