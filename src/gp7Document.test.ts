import {exportGp7} from './gp7Export';
import {readFileSync} from 'node:fs';
import {expect,it,vi,beforeEach} from 'vitest';
import {importer,exporter,Settings} from '@coderline/alphatab';
import {ensureGp7,updatedGp7,reconcileScoreState} from './gp7Document';
import {parseGuitarPro} from './guitarPro';
import {saveMaterial,loadMaterial,serializeScore,restoreScore} from './loopMaterials';
import {ChangeFretCommand} from '../vendor/fretwork/src/editor/commands/ChangeFret';
import type {ScoreDocument} from './ScoreStudio';
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>false,invoke:vi.fn()}));
beforeEach(()=>{const storage=new Map();vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)});});
it('keeps two guitar voices and unassigned pitches in one track through GP7 and storage',async()=>{
  const tuning=[64,59,55,50,45,40];
  const notes=[
    {midi:64,time:0,duration:.5,velocity:.8,track:4,position:{string:0,fret:0,tuning,capo:0,voice:1,source:'manual' as const}},
    {midi:66,time:0,duration:.5,velocity:.8,track:4,position:{string:0,fret:2,tuning,capo:0,voice:2,source:'manual' as const}},
    {midi:20,time:.5,duration:.5,velocity:.8,track:4},
    {midi:68,time:1,duration:.5,velocity:.8,track:4,position:{string:0,fret:4,tuning,capo:0,voice:75,source:'model' as const}},
    {midi:68,time:1,duration:.5,velocity:.8,track:4,position:{string:0,fret:4,tuning,capo:0,voice:76,source:'model' as const}}
  ];
  const doc:ScoreDocument={id:'two-voices',name:'Loop',bpm:120,duration:2,tracks:[{id:4,name:'Gitarre',count:5}],notes,origin:{kind:'analysis',start:0,end:2}};
  const converted=await ensureGp7(doc);
  const id=await saveMaterial({version:1,score:serializeScore(converted),analysis:null,scoreState:null,analysisTrack:4,offset:0});
  const result=await ensureGp7(restoreScore((await loadMaterial(id)).score!));
  expect(result.tracks).toEqual([{id:0,name:'Gitarre',count:5}]);
  expect(result.notes.map(n=>n.midi).sort((a,b)=>a-b)).toEqual([20,64,66,68,68]);
  expect(result.notes.filter(n=>n.position).map(n=>n.position!.voice).sort()).toEqual([1,2]);
  expect(result.notes.filter(n=>!n.position).map(n=>n.midi).sort()).toEqual([20,68,68]);
  expect(result.origin?.trackIds).toEqual([4]);
  expect(result.source?.notes).toEqual(notes);
});
async function fixture(name:string){const gp=Uint8Array.from(readFileSync(new URL(`./fixtures/${name}`,import.meta.url))).buffer;return {...await parseGuitarPro(gp),gp,id:'score',name} as ScoreDocument;}
it('folds legacy analysis voice tracks together without deleting overflow pitches or their source',async()=>{
  const base=await ensureGp7(await fixture('positions.gp5'));
  const position={string:0,fret:0,tuning:[64,59,55,50,45,40],capo:0,voice:1,source:'guitar-pro' as const};
  const notes=[{midi:64,time:0,duration:.5,velocity:.8,track:0,position},
    {midi:66,time:.5,duration:.5,velocity:.8,track:1,position:{...position,fret:2}},
    {midi:68,time:1,duration:.5,velocity:.8,track:2,position:{...position,fret:4}}];
  const source={notes:notes.map(n=>({...n,track:4})),tracks:[{id:4,name:'Gitarre',count:3}],duration:2,bpm:120};
  const result=await ensureGp7({...base,notes,source,duration:2,bpm:120,tracks:[{id:0,name:'Gitarre · Stimme 1',count:1},{id:1,name:'Gitarre · Stimme 2',count:1},{id:2,name:'Gitarre · Stimme 75',count:1}],origin:{kind:'analysis',start:0,end:2,trackIds:[4,4,4]}});
  expect(result.tracks).toEqual([{id:0,name:'Gitarre',count:3}]);
  expect(result.notes.map(n=>n.midi)).toEqual([64,66,68]);
  expect(result.notes.map(n=>n.position?.voice)).toEqual([1,2,undefined]);
  expect(result.source).toEqual(source);expect(result.origin?.trackIds).toEqual([4]);
});
it('converts a GP5 with tempo changes and repeats into GP7 without changing its playback events',async()=>{
  const original=await fixture('two-tracks.gp5'),gp7=await ensureGp7(original);
  expect(gp7.gpFormat).toBe('gp7');expect(gp7.name).toBe('two-tracks.gp');
  expect(gp7.notes.map(n=>[n.midi,n.time,n.duration,n.track])).toEqual(original.notes.map(n=>[n.midi,n.time,n.duration,n.track]));
});
it('round-trips a Fretwork fret edit through actual GP7 bytes and loop storage; undo restores the original pitch',async()=>{
  const original=await ensureGp7(await fixture('positions.gp5')),settings=new Settings();
  const score=importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(original.gp!),settings);
  const target=score.tracks[0].staves[0].bars[0].voices[0].beats.find(b=>b.notes.length)!;
  const n=target.notes[0],oldFret=n.fret,oldPitch=n.realValue;
  const command=new ChangeFretCommand({trackIndex:0,staffIndex:0,barIndex:0,voiceIndex:0,beatIndex:target.index},n.string,oldFret+1);
  command.apply(score);
  const edited=await updatedGp7(original,new exporter.Gp7Exporter().export(score,settings).slice().buffer);
  expect(edited.notes.some(n=>n.midi===oldPitch+1&&n.position?.fret===oldFret+1)).toBe(true);
  const id=await saveMaterial({version:1,score:serializeScore(edited),analysis:null,scoreState:null,analysisTrack:0,offset:8});
  const restored=restoreScore((await loadMaterial(id)).score!),reloaded=await ensureGp7(restored);
  expect(reloaded.notes).toEqual(edited.notes);expect(reloaded.edited).toBe(false);
  command.undo(score);expect(n.fret).toBe(oldFret);expect(n.realValue).toBe(oldPitch);
});
it('turns analysis events into playable GP7 and preserves the exact source timing and track association',async()=>{
  const doc:ScoreDocument={id:'analysis',name:'Loop',bpm:120,duration:2,tracks:[{id:4,name:'Gitarre',count:2},{id:1,name:'Piano',count:1}],notes:[{midi:64,time:.01,duration:1,velocity:.8,track:4,position:{string:0,fret:0,tuning:[64,59,55,50,45,40],capo:0,voice:1,source:'manual'}},{midi:66,time:1,duration:.5,velocity:.8,track:4,position:{string:0,fret:2,tuning:[64,59,55,50,45,40],capo:0,voice:1,source:'manual'}},{midi:60,time:.5,duration:.5,velocity:.8,track:1}],origin:{kind:'analysis',start:8,end:10}};
  const result=await ensureGp7(doc);
  expect(result.source?.notes).toEqual(doc.notes);expect(result.origin?.trackIds).toEqual([4,1]);
  expect(result.notes.map(n=>n.midi).sort()).toEqual([60,64,66]);
  expect(result.notes.find(n=>n.midi===66)?.position?.fret).toBe(2);
  expect(result.notes.find(n=>n.midi===60)?.position).toBeUndefined();
  expect(result.tracks).toHaveLength(2);
});
it('allows deleting the last note and keeping the resulting rest-only GP7 document',async()=>{
  const doc=await ensureGp7(await fixture('positions.gp5')),settings=new Settings();
  const score=importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(doc.gp!),settings);
  for(const t of score.tracks)for(const s of t.staves)for(const bar of s.bars)for(const voice of bar.voices)for(const beat of voice.beats)beat.notes=[];
  score.finish(settings);
  const empty=await updatedGp7(doc,new exporter.Gp7Exporter().export(score,settings).slice().buffer);
  expect(empty.notes).toEqual([]);expect(empty.tracks.length).toBeGreaterThan(0);expect(empty.duration).toBeGreaterThan(0);
});
it('keeps media alignment for pitch edits and clears it for changed timing',async()=>{
  const before=await ensureGp7(await fixture('positions.gp5'));
  const state={track:0,start:0,end:before.duration,speed:1,loop:true,alignment:{scoreStart:0,scoreEnd:before.duration,mediaStart:8,mediaEnd:10}};
  expect(reconcileScoreState(before,{...before,notes:before.notes.map(n=>({...n,midi:n.midi+1}))},state)?.alignment).toEqual(state.alignment);
  expect(reconcileScoreState(before,{...before,duration:before.duration+2},state)?.alignment).toBeNull();
});

it('preserves low and high piano notes through repeated exports without mutating the live score',async()=>{
  const settings=new Settings(),parser=new importer.AlphaTexImporter();
  parser.initFromString('\\instrument 0 . (a0 c8).4',settings);
  const score=parser.readScore(),notes=score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes;
  const pitches=notes.map(n=>n.realValue);
  for(let i=0;i<2;i++){
    const bytes=exportGp7(score,settings).slice().buffer;
    expect((await parseGuitarPro(bytes)).notes.map(n=>n.midi).sort((a,b)=>a-b)).toEqual([...pitches].sort((a,b)=>a-b));
    expect(notes.every(n=>!n.isStringed)).toBe(true);expect(notes.map(n=>n.realValue)).toEqual(pitches);
  }
});
