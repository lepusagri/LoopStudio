import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Fretboard } from './Fretboard';
import { applyFingerings } from './fingering';
import { tuning, type Note } from './music';

const note: Note = { midi:64,time:0,duration:1,velocity:.8,track:0 };
describe('one position per note', () => {
  it('maps native model strings to one high-to-low display position without altering timing', () => {
    const result = applyFingerings([note], { notes:[{index:0,pitch:64,string:2,fret:5,guitar:1}],unassigned:[],extra_guitars:0,wide_grips:0 });
    expect(result.notes[0]).toMatchObject({time:0,duration:1,position:{string:1,fret:5,source:'model'}});
    expect(note.position).toBeUndefined();
  });
  it('rejects mismatched model pitches instead of displaying a wrong position', () => {
    expect(() => applyFingerings([note],{notes:[{index:0,pitch:64,string:2,fret:4,guitar:1}],unassigned:[],extra_guitars:0,wide_grips:0})).toThrow();
  });
  it('renders B-string fret 5 once, not all equivalent E4 positions', () => {
    const notes:Note[] = [{...note,position:{string:1,fret:5,tuning,capo:0,voice:1,source:'guitar-pro'}}];
    const svg=renderToStaticMarkup(<Fretboard notes={notes} time={.5} leftHanded={false} originalPositions/>);
    expect(svg.match(/data-fret=/g)).toHaveLength(1);
    expect(svg).toContain('data-string="2" data-fret="5"');
    expect(renderToStaticMarkup(<Fretboard notes={notes} time={1} leftHanded={false} originalPositions/>)).not.toContain('data-fret=');
  });
});
