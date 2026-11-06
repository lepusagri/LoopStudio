import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { demoNotes, isActive, loopTarget, parseMidi, peaksFrom, synthWav, validLoop } from './music';
describe('music transport', () => {
  it('rejects inverted and out-of-range loops and wraps at B', () => {
    expect(validLoop(5, 4, 10)).toBe(false); expect(validLoop(0, 20, 10)).toBe(false);
    expect(validLoop(2, 4, 10)).toBe(true); expect(loopTarget(4.01, 2, 4, true)).toBe(2);
    expect(loopTarget(3, 2, 4, true)).toBeNull(); expect(loopTarget(4, 2, 4, false)).toBeNull();
  });
  it('uses note duration boundaries consistently', () => {
    const n = { midi: 60, time: 2, duration: 1, velocity: 1, track: 0 };
    expect(isActive(n, 2)).toBe(true); expect(isActive(n, 3)).toBe(false);
  });
  it('imports MIDI tempo changes into seconds and ignores drums', () => {
    const midi = new Midi(); midi.header.tempos = [{ ticks: 0, bpm: 120 }, { ticks: 480, bpm: 60 }]; midi.header.update();
    midi.addTrack().addNote({ midi: 60, ticks: 0, durationTicks: 480, velocity: 0.7 }).addNote({ midi: 64, ticks: 480, durationTicks: 480, velocity: 0.8 });
    const drum = midi.addTrack(); drum.channel = 9; drum.addNote({ midi: 36, ticks: 0, durationTicks: 120 });
    const bytes = midi.toArray(); const parsed = parseMidi(bytes.buffer as ArrayBuffer);
    expect(parsed.notes).toHaveLength(2); expect(parsed.notes[0].duration).toBeCloseTo(0.5); expect(parsed.notes[1].duration).toBeCloseTo(1);
  });
  it('generates a playable WAV and real waveform from the demo', async () => {
    const { blob, samples } = synthWav(demoNotes(), 19.2);
    const view = new DataView(await blob.arrayBuffer());
    expect(view.getUint32(24, true)).toBe(22050); expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(peaksFrom(samples).some(p => p > 0.8)).toBe(true);
  });
});
