import { expect,it } from 'vitest';
import { importer,midi,Settings } from '@coderline/alphatab';
import { notationTex } from './notationData';
import type { Note } from './music';
function attacks(notes:Note[],duration:number){
  const settings=new Settings(), parser=new importer.AlphaTexImporter();parser.initFromString(notationTex(notes,120,duration),settings);
  const score=parser.readScore(), file=new midi.MidiFile(), handler=new midi.AlphaSynthMidiFileHandler(file,true);
  const events:{key:number;length:number}[]=[];
  handler.addNote=(_track,_start,length,key)=>events.push({key,length});
  new midi.MidiFileGenerator(score,settings,handler).generate();
  return events;
}
const note:Note={midi:64,time:0,duration:3,velocity:.8,track:0};
it('keeps a sustained note tied across a bar with one MIDI attack',()=>{
  const result=attacks([note],3);
  expect(result).toHaveLength(1);expect(result[0].length).toBe(5760);
});
it('keeps two separate repeated notes as two attacks',()=>{
  expect(attacks([{...note,duration:.5},{...note,time:.5,duration:.5}],1)).toHaveLength(2);
});
it('keeps a held note while another voice starts and ends',()=>{
  const result=attacks([{...note,duration:1},{...note,midi:67,time:.25,duration:.5}],1);
  expect(result.map(n=>n.key).sort()).toEqual([64,67]);
});
