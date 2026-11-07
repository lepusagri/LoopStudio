import {expect,it} from 'vitest';
import {alignmentForPractice,mappedTime} from './scoreTransport';
it('uses the confirmed video alignment in practice and maps a loop restart back to the first note',()=>{
 const alignment={scoreStart:0,scoreEnd:4,mediaStart:10,mediaEnd:14};
 const confirmed=alignmentForPractice(alignment,10,14)!;
 expect(mappedTime(12,confirmed)).toBe(2);expect(mappedTime(10,confirmed)).toBe(0);
 expect(alignmentForPractice(alignment,20,24)).toBeNull();
 expect(alignmentForPractice(null,10,14)).toBeNull();
});
