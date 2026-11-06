import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseGuitarPro } from './guitarPro';
async function fixture(name:string) { return parseGuitarPro(Uint8Array.from(readFileSync(new URL(`./fixtures/${name}.gp5`, import.meta.url))).buffer); }
it('preserves exact original positions across repeats and tempo changes',async()=>{
  const doc=await fixture('two-tracks');
  const notes=doc.notes.filter(n=>n.track===0);
  expect(notes.map(n=>[n.position?.string,n.position?.fret])).toEqual(Array.from({length:4},()=>[0,2,4,5].map(f=>[0,f])).flat());
});
it('preserves distinct unisons, drop tuning, capo and frets above 15',async()=>{
  const doc=await fixture('positions');
  expect(doc.notes.map(n=>[n.position?.string,n.position?.fret])).toEqual([[0,0],[1,5],[1,5],[0,0],[0,22],[5,0]]);
  expect(doc.notes.every(n=>n.position?.capo===2)).toBe(true);
  expect(doc.notes.every(n=>n.position?.tuning[5]===38)).toBe(true);
  expect(doc.notes.slice(0,4).map(n=>n.midi)).toEqual([66,66,66,66]);
});
