import type { Note } from './music';
const names=['c','c#','d','d#','e','f','f#','g','g#','a','a#','b'];
const pitch=(m:number)=>names[m%12]+(Math.floor(m/12)-1);
export function notationTex(notes:Note[],bpm:number,duration:number,tab=false,meter={numerator:4,denominator:4}):string {
  if(tab&&notes.some(n=>!n.position))throw new Error('Für manche Noten fehlt eine Saitenposition. Bitte die Notenansicht verwenden oder die Position im Editor ergänzen.');
  const first=notes.find(n=>n.position)?.position;
  const metadata=tab&&first?`\\tuning ${first.tuning.map(pitch).join(' ')} \\capo ${first.capo} `:'';
  const cellsPerBar=meter.numerator*16/meter.denominator;
  const step=60/(bpm||120)/4;
  const grid=Array.from({length:Math.min(4096,Math.ceil(duration/step))},(_,i)=>notes.filter(n=>n.time<(i+1)*step-1e-8 && n.time+n.duration>i*step+1e-8));
  const cells:string[]=[];
  for(let i=0;i<grid.length;){
    const sounding=grid[i];let run=1;
    while(i+run<grid.length && (i+run)%cellsPerBar!==0 && grid[i+run].length===sounding.length && grid[i+run].every((n,j)=>n===sounding[j]))run++;
    // Keep sustained notes as durations/ties, rather than inventing repeated attacks.
    const size=[16,14,12,8,7,6,4,3,2,1].find(s=>s<=run)!;
    const dots=[14,7].includes(size)?'dd':[12,6,3].includes(size)?'d':'';
    const base=dots==='dd'?size/1.75:dots==='d'?size/1.5:size;
    const values=sounding.map(n=>(tab?`${n.position!.fret}.${n.position!.string+1}`:pitch(n.midi))+(i>0&&grid[i-1].includes(n)?'{t}':''));
    const tokens=tab?[...new Set(values)]:values;
    const value=tokens.length?'('+tokens.join(' ')+').'+(16/base):'r.'+(16/base);
    cells.push(value+(dots?`{${dots}}`:'')+((i+size)%cellsPerBar===0?' |':''));
    i+=size;
  }
  return metadata+'\\tempo '+(bpm||120)+' . \\ts '+meter.numerator+' '+meter.denominator+' '+cells.join(' ');
}
