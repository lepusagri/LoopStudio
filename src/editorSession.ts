// One modal editor owns unsaved changes. Window close waits for its acknowledged commit.
let active: (()=>Promise<void>) | null = null;
export function registerEditorFlush(flush:()=>Promise<void>) {
  if(active)throw new Error('Ein Noteneditor ist bereits geöffnet.');
  active=flush;
  return ()=>{if(active===flush)active=null;};
}
export async function flushOpenEditor(){await active?.();}

export function hasOpenEditor(){return active!==null;}
