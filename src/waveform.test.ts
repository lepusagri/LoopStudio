import { afterEach, expect, it, vi } from 'vitest';
import { readWaveform } from './waveform';
afterEach(()=>vi.unstubAllGlobals());
it.each(['blob','native'])('uses the existing decoder for %s video input and closes its audio context',async kind=>{
  const data=new Uint8Array([1,2,3,4]),file=new Blob([data],{type:'video/mp4'});
  const close=vi.fn(async()=>{}),decodeAudioData=vi.fn(async(_data:ArrayBuffer)=>({getChannelData:()=>new Float32Array([0,.2,.8,-.4])}));
  vi.stubGlobal('AudioContext',function(){return {state:'running',close,decodeAudioData};});
  const fetch=vi.fn(async()=>new Response(file));vi.stubGlobal('fetch',fetch);
  const peaks=await readWaveform(kind==='blob'?file:'http://asset.localhost/movie.mp4',new AbortController().signal);
  expect(peaks).toHaveLength(600);expect(Math.max(...peaks)).toBe(1);
  expect(new Uint8Array(decodeAudioData.mock.calls[0][0] as ArrayBuffer)).toEqual(data);
  expect(close).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledTimes(kind==='native'?1:0);
});
it('discards a slow decoder after switching the recording',async()=>{
  let started!:()=>void,complete!:(buffer:unknown)=>void;
  const began=new Promise<void>(r=>{started=r;}),decoded=new Promise(r=>{complete=r;});
  const context={state:'running',close:vi.fn(async()=>{context.state='closed';}),decodeAudioData:()=>{started();return decoded;}};
  vi.stubGlobal('AudioContext',function(){return context;});
  const controller=new AbortController(),wave=readWaveform(new Blob(['video']),controller.signal);
  await began;controller.abort();complete({getChannelData:()=>new Float32Array([1])});
  await expect(wave).rejects.toMatchObject({name:'AbortError'});expect(context.close).toHaveBeenCalledOnce();
});
