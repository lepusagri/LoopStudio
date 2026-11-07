import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { importer, Settings } from '@coderline/alphatab';

const worker = process.env.LOOPSTUDIO_TAB_TOOLS_EXE;
it.skipIf(!worker || !existsSync(worker))('reads current Rust GP5 output through the independent alphaTab importer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loopstudio-native-tabs-'));
  try {
    const tokens = join(directory, 'tokens.txt'), output = join(directory, 'native.gp5');
    writeFileSync(tokens, 'TS_4_4 CAPO_2 TEMPO_90 BAR BEAT DUR_1 N_S1_F3 N_S2_FX N_S6_F2 END_BAR TS_6_8 BAR BEAT DUR_4 DOTS_1 N_S1_F0 BEAT DUR_4 DOTS_1 N_S2_F12 END_BAR');
    execFileSync(worker!, ['--runtime', directory, '--output', output, 'tokens', tokens]);
    const score = importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(output)), new Settings());
    expect(score.tempo).toBe(90);
    expect(score.masterBars.map(bar => [bar.timeSignatureNumerator, bar.timeSignatureDenominator])).toEqual([[4,4],[6,8]]);
    const staff = score.tracks[0].staves[0];
    expect(staff.capo).toBe(2);
    expect(staff.bars[0].voices[0].beats[0].notes.map(note => [note.string, note.fret, note.isDead])).toEqual([[6,2,false],[2,0,true],[1,3,false]]);
    expect(staff.bars[1].voices[0].beats.map(beat => [beat.duration, beat.dots])).toEqual([[4,1],[4,1]]);
  } finally {
    rmSync(directory, {recursive:true,force:true});
  }
}, 30000);
