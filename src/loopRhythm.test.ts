import {expect,it} from 'vitest';
import * as at from '@coderline/alphatab';
import {notationTex} from './notationData';
it.each([{numerator:3,denominator:4},{numerator:6,denominator:8}])('creates two bars in $numerator/$denominator without changing three seconds of notes',meter=>{
 const importer=new at.importer.AlphaTexImporter();
 importer.initFromString(notationTex([{midi:60,time:0,duration:3,track:0,velocity:.8}],120,3,false,meter),new at.Settings());
 const score=importer.readScore();
 expect(score.masterBars).toHaveLength(2);
 expect(score.masterBars.every(b=>b.timeSignatureNumerator===meter.numerator&&b.timeSignatureDenominator===meter.denominator)).toBe(true);
});
