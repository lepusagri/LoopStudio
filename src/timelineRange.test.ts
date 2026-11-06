import { expect, it } from 'vitest';
import { moveMarker, pointerTime } from './timelineRange';
import { validLoop } from './music';
it('maps mouse coordinates to the recording and clamps releases outside the waveform',()=>{
  expect(pointerTime(350,100,1000,200)).toBe(50);
  expect(pointerTime(-10,100,1000,200)).toBe(0);
  expect(pointerTime(1200,100,1000,200)).toBe(200);
});
it('moves either passage boundary without crossing the other or leaving the recording',()=>{
  expect(moveMarker({a:10,b:20},'a',25,100)).toEqual({a:19.9,b:20});
  expect(moveMarker({a:10,b:20},'b',5,100)).toEqual({a:10,b:10.1});
  expect(moveMarker({a:10,b:20},'b',150,100)).toEqual({a:10,b:100});
  expect(moveMarker({a:10,b:20},'a',-1,100)).toEqual({a:0,b:20});
});
it('keeps an unfinished selection unfinished and preserves it for invalid input',()=>{
  expect(moveMarker({a:10,b:null},'a',50,100)).toEqual({a:50,b:null});
  expect(moveMarker({a:10,b:20},'a',NaN,100)).toEqual({a:10,b:20});
});

it('retains a valid tenth-second loop at floating point boundaries',()=>{
  const range=moveMarker({a:99.9,b:120},'b',50,225.33);
  expect(validLoop(range.a,range.b,225.33)).toBe(true);
});
