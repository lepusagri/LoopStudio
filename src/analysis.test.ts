import { describe, expect, it } from 'vitest';
import { passagePosition, stemVolume } from './analysis';
describe('stem transport', () => {
  it('uses original time outside the analyzed region and resets to zero at A', () => {
    expect(passagePosition(9.9, 10, 20)).toBeNull();
    expect(passagePosition(10, 10, 20)).toBe(0);
    expect(passagePosition(15.4, 10, 20)).toBeCloseTo(5.4);
    expect(passagePosition(20, 10, 20)).toBeNull();
  });
  it('mutes excluded stems, permits multiple solos, and preserves master gain', () => {
    expect(stemVolume({ muted: false, solo: true, volume: 0.8 }, true, 0.5)).toBeCloseTo(0.4);
    expect(stemVolume({ muted: false, solo: false, volume: 1 }, true, 1)).toBe(0);
    expect(stemVolume({ muted: true, solo: true, volume: 1 }, true, 1)).toBe(0);
    expect(stemVolume({ muted: false, solo: false, volume: 1 }, false, 0.7)).toBe(0.7);
  });
});
