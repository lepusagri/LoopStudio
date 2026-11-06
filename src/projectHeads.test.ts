import { expect, it } from 'vitest';
import { ProjectHeads } from './projectHeads';
import type { LoopMaterial } from './loopMaterials';
const material:LoopMaterial={version:1,analysis:null,score:null,scoreState:null,analysisTrack:-1,offset:0};
const loop=(id:string,materialId:string)=>({id,name:id,start:0,end:1,materialId});
it('keeps the edited attachment of the previous loop when switching loops before its save finishes',async()=>{
  const heads=new ProjectHeads();let finish!:(id:string)=>void;
  heads.stage('A',material,new Promise(resolve=>{finish=resolve;}));
  const oldSnapshot=heads.resolve([loop('A','old-A'),loop('B','old-B')],async()=>{throw Error('unexpected retry');});
  heads.stage('B',material,Promise.resolve('new-B'));
  const nextSnapshot=heads.resolve([loop('A','old-A'),loop('B','old-B')],async()=>{throw Error('unexpected retry');});
  finish('new-A');
  expect((await oldSnapshot).map(l=>l.materialId)).toEqual(['new-A','old-B']);
  expect((await nextSnapshot).map(l=>l.materialId)).toEqual(['new-A','new-B']);
  expect(await heads.get('A')).toBe('new-A');
});
it('retries a failed attachment with its retained notes instead of silently reverting to the old saved loop',async()=>{
  const heads=new ProjectHeads();heads.stage('A',material,Promise.reject(Error('disk full')));
  let retried:LoopMaterial|undefined;
  const saved=await heads.resolve([loop('A','old')],async value=>{retried=value;return 'recovered';});
  expect(retried).toBe(material);expect(saved[0].materialId).toBe('recovered');
  expect(await heads.get('A')).toBe('recovered');
});
it('does not resurrect deleted loops or carry attachments into another project',async()=>{
  const heads=new ProjectHeads();heads.stage('deleted',material,Promise.resolve('new'));
  expect(await heads.resolve([],async()=>'' )).toEqual([]);
  heads.clear();expect(await heads.resolve([loop('deleted','other-project')],async()=>'' )).toEqual([loop('deleted','other-project')]);
});

it('shares a retry between concurrent saves of the same failed attachment',async()=>{
  const heads=new ProjectHeads();heads.stage('A',material,Promise.reject(Error('disk full')));
  let retries=0;
  const retry=async()=>{retries++;return 'recovered';};
  const snapshots=await Promise.all([heads.resolve([loop('A','old')],retry),heads.resolve([loop('A','old')],retry)]);
  expect(retries).toBe(1);expect(snapshots.map(s=>s[0].materialId)).toEqual(['recovered','recovered']);
});
