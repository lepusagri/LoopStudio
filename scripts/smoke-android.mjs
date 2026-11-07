// Exercise only the preview app's private test data on an explicitly chosen device.
// Node 22+, Android platform-tools, and an installed debug preview APK are required.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const adb=option('--adb','adb');
const serial=option('--serial','emulator-5554');
const packageName=option('--package','local.loopstudio.preview');
const output=option('--output','.installer/evidence/android');
if(!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(packageName))throw Error('Invalid package name');
function device(commands,input){const result=spawnSync(adb,['-s',serial,...commands],{input,encoding:input?undefined:'utf8',maxBuffer:5*1024*1024});if(result.status!==0)throw Error(String(result.stderr??result.error));return result.stdout;}
device(['shell','am','start','-n',`${packageName}/.MainActivity`]);
await new Promise(r=>setTimeout(r,1000));
const pid=device(['shell','pidof',packageName]).trim();
if(!/^\d+$/.test(pid))throw Error('Preview process missing');
device(['forward','tcp:9222',`localabstract:webview_devtools_remote_${pid}`]);
let pages;
for(let i=0;i<45;i++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1500);
    try{const list=await fetch('http://127.0.0.1:9222/json/list',{signal:controller.signal}).then(r=>r.json());if(list.some(p=>p.url.startsWith('http://tauri.localhost'))){pages=list;break;}}catch{}
    finally{clearTimeout(timer);}
    await new Promise(r=>setTimeout(r,500));
}
if(!pages)throw Error('Android WebView debugging endpoint did not become ready');
const socket=new WebSocket(pages.find(p=>p.url.startsWith('http://tauri.localhost')).webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
let id=0;const pending=new Map();
socket.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id){const p=pending.get(value.id);pending.delete(value.id);if(value.error)p.reject(value.error);else p.resolve(value.result);}});
function call(method,params={}){const callId=++id;return new Promise((resolve,reject)=>{pending.set(callId,{resolve,reject});socket.send(JSON.stringify({id:callId,method,params}));});}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function waitFor(expression){for(let i=0;i<60;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,500));}throw Error(`Timed out: ${expression}`);}
try {
    await evaluate(`[...document.querySelectorAll('.area-mobile button')].find(b=>b.textContent==='Projekte')?.click()`);
    await waitFor(`!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('Demo ausprobieren'))`);
    const initial=await evaluate(`({title:document.title,agent:navigator.userAgent,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,previewNotice:!!document.querySelector('.android-preview-note'),projectsDisabled:[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Neues Projekt'))?.disabled})`);
    if(!initial.previewNotice||!initial.projectsDisabled||initial.scrollWidth>initial.width)throw Error(JSON.stringify(initial));
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Demo ausprobieren')).click()`);
    await waitFor(`document.body.innerText.includes('Evening practice')&&!document.querySelector('.project-operation')&&!!document.querySelector('video')`);
    const demo=await evaluate(`(async()=>{const v=document.querySelector('video');await v.play();await new Promise(r=>setTimeout(r,1100));const result={duration:v.duration,currentTime:v.currentTime};v.pause();return result;})()`);
    if(demo.currentTime<=0)throw Error('Demo playback did not advance');
    const home=device(['shell','run-as',packageName,'pwd']).trim();
    if(!home.endsWith('/'+packageName))throw Error('Unexpected application data directory');
    device(['shell','run-as',packageName,'mkdir','-p','cache/loopstudio-tests']);
    function fixture(name,buffer){const local=path.resolve(output,'fixtures',name);fs.mkdirSync(path.dirname(local),{recursive:true});fs.writeFileSync(local,buffer);const temporary=`/data/local/tmp/loopstudio-${packageName}-${name}`;device(['push',local,temporary]);device(['shell','run-as',packageName,'cp',temporary,`cache/loopstudio-tests/${name}`]);const size=Number(device(['exec-out','run-as',packageName,'stat','-c','%s',`cache/loopstudio-tests/${name}`]).trim());if(size!==buffer.length)throw Error('Fixture transfer was incomplete');return `${home}/cache/loopstudio-tests/${name}`;}
    const wave=Buffer.alloc(44+44100*2*2);
    wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(44100,24);wave.writeUInt32LE(88200,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(wave.length-44,40);
    for(let i=0;i<88200;i++)wave.writeInt16LE(Math.round(8000*Math.sin(2*Math.PI*220*i/44100)),44+i*2);
    const wavePath=fixture('loopstudio-tone.wav',wave);
    async function importFile(selector,file){const document=await call('DOM.getDocument');const node=await call('DOM.querySelector',{nodeId:document.root.nodeId,selector});if(!node.nodeId)throw Error('File input missing');await call('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[file]});}
    await importFile('input[accept^="audio/"]',wavePath);
    await waitFor(`document.body.innerText.includes('loopstudio-tone.wav')&&document.querySelector('video')?.duration>1.9`);
    await evaluate(`(async()=>{const v=document.querySelector('video');v.currentTime=.2;await new Promise(r=>setTimeout(r,300));document.querySelectorAll('.marker-button')[0].click();v.currentTime=1.5;await new Promise(r=>setTimeout(r,300));document.querySelectorAll('.marker-button')[1].click();})()`);
    const loop=await evaluate(`(async()=>{const v=document.querySelector('video');v.currentTime=1.8;await v.play();await new Promise(r=>setTimeout(r,650));const result={currentTime:v.currentTime,markers:[...document.querySelectorAll('.marker-button')].map(b=>b.textContent)};v.pause();return result;})()`);
    if(loop.currentTime<.15||loop.currentTime>1.5)throw Error(`A/B loop did not repeat: ${JSON.stringify(loop)}`);
    await evaluate(`document.querySelector('.save-loop button').click()`);
    await new Promise(r=>setTimeout(r,800));
    const sessions=await evaluate(`window.__TAURI_INTERNALS__.invoke('load_sessions',{})`);
    if(!sessions[0]?.key.startsWith('loopstudio-tone.wav:')||!sessions[0].loops.some(l=>Math.abs(l.start-.2)<.02&&Math.abs(l.end-1.5)<.02))throw Error('Loop session was not persisted');
    const track=Buffer.from([0,0xc0,25,0,0x90,64,100,0x83,0x60,0x80,64,0,0,0xff,0x2f,0]);
    const header=Buffer.from([0x4d,0x54,0x68,0x64,0,0,0,6,0,0,0,1,1,0xe0,0x4d,0x54,0x72,0x6b,0,0,0,track.length]);
    const midiPath=fixture('loopstudio-notes.mid',Buffer.concat([header,track]));
    await importFile('input[accept=".mid,.midi,.gp3,.gp4,.gp5,.gpx,.gp"]',midiPath);
    await waitFor(`document.body.innerText.includes('loopstudio-notes.gp')&&document.body.innerText.includes('E4')`);
    await evaluate(`document.querySelector('.notation-viewport').scrollIntoView({block:'center'})`);
    await waitFor(`!!document.querySelector('.notation-viewport svg,.notation-viewport canvas')`);
    fs.mkdirSync(output,{recursive:true});
    const result={initial,demo,audioFileImported:true,loop,persistedLoop:true,midiImported:true,notationRendered:true,physicalDevice:!serial.startsWith('emulator-')};
    fs.writeFileSync(path.join(output,'smoke.json'),JSON.stringify(result,null,2));
    device(['shell','screencap','-p','/sdcard/loopstudio-smoke.png']);
    device(['pull','/sdcard/loopstudio-smoke.png',path.join(output,'screen.png')]);
    console.log(JSON.stringify(result,null,2));
} finally { socket.close(); }
