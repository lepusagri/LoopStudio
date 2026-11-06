import { describe, expect, it } from 'vitest';
import { importer, Settings } from '@coderline/alphatab';
import { editedNote, recountTracks, replaceNote } from './noteEditing';
import { notationTex } from './notationData';
import { tuning, type Note } from './music';
import { applyFingerings } from './fingering';
const original:Note={midi:64,time:0,duration:.5,velocity:.8,track:4,position:{string:0,fret:0,tuning,capo:0,voice:1,source:'guitar-pro'}};
describe('editing loop notes',()=>{
  it('changes one note immutably, retains other tracks and updates track counts',()=>{
    const other={...original,track:5};
    const next=replaceNote([original,other],0,{midi:66,time:.1,duration:.25,velocity:.6,string:0,fret:2},2);
    expect(original.midi).toBe(64);
    expect(next.find(n=>n.track===4)).toMatchObject({midi:66,time:.1,duration:.25,position:{fret:2,string:0,source:'manual'}});
    expect(next.find(n=>n.track===5)).toBe(other);
    expect(recountTracks([{id:4,count:1},{id:5,count:1}],next.filter(n=>n.track!==4))).toEqual([{id:4,count:0},{id:5,count:1}]);
  });
  it('rejects notes outside the passage and positions with a mismatched pitch',()=>{
    expect(()=>editedNote(original,{midi:64,time:1.9,duration:.5,velocity:.8},2)).toThrow();
    expect(()=>editedNote(original,{midi:64,time:0,duration:.5,velocity:.8,string:1,fret:4},2)).toThrow();
    expect(()=>editedNote(original,{midi:64,time:NaN,duration:.5,velocity:.8},2)).toThrow();
  });
  it('keeps manually chosen strings when the learned model suggests another position',()=>{
    const note=editedNote(original,{midi:64,time:0,duration:.5,velocity:.8,string:1,fret:5},2);
    const result=applyFingerings([note],{notes:[{index:0,pitch:64,string:1,fret:0,guitar:1}],unassigned:[],extra_guitars:0,wide_grips:0});
    expect(result.notes[0].position).toMatchObject({string:1,fret:5,source:'manual'});
  });
});
function parse(tex:string){const input=new importer.AlphaTexImporter();input.initFromString(tex,new Settings());return input.readScore();}
it('alphaTab renders changed pitches rather than the original imported file',()=>{
  const note=editedNote(original,{midi:66,time:0,duration:.125,velocity:.8},1);
  const score=parse(notationTex([note],120,1));
  const first=score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0];
  expect(first.realValue).toBe(66);
});
it('alphaTab preserves edited tab position, nonstandard tuning and capo',()=>{
  const drop=[64,59,55,50,45,38];
  const base={...original,position:{...original.position!,tuning:drop,capo:2}};
  const note=editedNote(base,{midi:40,time:0,duration:.125,velocity:.8,string:5,fret:0},1,drop,2);
  const score=parse(notationTex([note],120,1,true));
  const staff=score.tracks[0].staves[0],first=staff.bars[0].voices[0].beats[0].notes[0];
  expect(staff.tuning[5]).toBe(38);expect(staff.capo).toBe(2);
  expect(first.fret).toBe(0);expect(first.realValue).toBe(40);
});
