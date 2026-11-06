import {expect,it} from 'vitest';
import {registerEditorFlush,flushOpenEditor,hasOpenEditor} from './editorSession';
it('waits for editor persistence before a close can finish, and retains the editor after a failed save',async()=>{
  let attempts=0,release:()=>void=()=>{};
  const pending=new Promise<void>(resolve=>release=resolve);
  const unregister=registerEditorFlush(async()=>{if(++attempts===1)throw new Error('Disk full');await pending;});
  try{
    await expect(flushOpenEditor()).rejects.toThrow('Disk full');expect(hasOpenEditor()).toBe(true);
    let closed=false;const closing=flushOpenEditor().then(()=>closed=true);
    await Promise.resolve();expect(closed).toBe(false);release();await closing;expect(closed).toBe(true);
  }finally{unregister();}
  expect(hasOpenEditor()).toBe(false);await flushOpenEditor();
});
