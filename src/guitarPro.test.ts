import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGuitarPro } from './guitarPro';

describe('Guitar Pro 5 playback import', () => {
  it('keeps tracks separate and unfolds the repeated bars with their tempo changes', async () => {
    const bytes = readFileSync(new URL('./fixtures/two-tracks.gp5', import.meta.url));
    const score = await parseGuitarPro(Uint8Array.from(bytes).buffer);
    expect(score.tracks.map(t => t.name)).toEqual(['Leadgitarre', 'Piano']);
    expect(score.tracks.map(t => t.count)).toEqual([16, 16]);
    const guitar = score.notes.filter(n => n.track === score.tracks[0].id);
    expect(guitar.map(n => n.midi)).toEqual([64, 66, 68, 69, 64, 66, 68, 69, 64, 66, 68, 69, 64, 66, 68, 69]);
    expect(guitar.map(n => n.time)).toEqual([0, .5, 1, 1.5, 2, 3, 4, 5, 6, 6.5, 7, 7.5, 8, 9, 10, 11]);
    expect(score.duration).toBeCloseTo(12);
  });
  it('rejects malformed files', async () => {
    await expect(parseGuitarPro(new ArrayBuffer(20))).rejects.toThrow();
  });
});
