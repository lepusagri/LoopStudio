import { expect, it, vi } from 'vitest';
import { Window as TauriWindow } from '@tauri-apps/api/window';
import { closeAfterSaving } from './windowClose';
import capabilities from '../src-tauri/capabilities/default.json';

async function windowWithHandler(flush:()=>Promise<void>) {
  let listener!:(event:unknown)=>Promise<void>;
  const destroy=vi.fn(async()=>{}),onError=vi.fn(),transition={current:false};
  const window={listen:vi.fn(async (_name:string,handler:typeof listener)=>{listener=handler;return()=>{};}),destroy};
  await TauriWindow.prototype.onCloseRequested.call(window as unknown as TauriWindow,closeAfterSaving({transition,hasProject:()=>true,flush,onBusy:vi.fn(),onError}));
  return {request:()=>listener({event:'tauri://close-requested',id:1,payload:null}),destroy,onError,transition};
}
it('the installed Tauri close flow saves first and destroys the window once without recursively requesting close',async()=>{
  let saved!:()=>void;
  const app=await windowWithHandler(()=>new Promise<void>(resolve=>{saved=resolve;}));
  const closing=app.request();expect(app.destroy).not.toHaveBeenCalled();
  // A second click during the same save must not bypass the pending write.
  await app.request();expect(app.destroy).not.toHaveBeenCalled();
  saved();await closing;
  expect(app.destroy).toHaveBeenCalledTimes(1);expect(app.onError).not.toHaveBeenCalled();
  expect(capabilities.permissions).toContain('core:window:allow-destroy');
});
it('a failed save keeps the window open and a later close can retry',async()=>{
  const flush=vi.fn().mockRejectedValueOnce(Error('disk full')).mockResolvedValueOnce(undefined);
  const app=await windowWithHandler(flush);
  await app.request();expect(app.destroy).not.toHaveBeenCalled();expect(app.onError).toHaveBeenCalledOnce();
  expect(app.transition.current).toBe(false);
  await app.request();expect(app.destroy).toHaveBeenCalledOnce();
});
