import { expect, it } from 'vitest';
import { mappedTime, validAlignment } from './scoreTransport';
it('maps both anchors and an intermediate time across different passage lengths', () => {
 const a={scoreStart:10,scoreEnd:22,mediaStart:40,mediaEnd:46};
 expect(validAlignment(a)).toBe(true);
 expect(mappedTime(40,a)).toBe(10); expect(mappedTime(43,a)).toBe(16); expect(mappedTime(46,a)).toBe(22);
 expect(mappedTime(40,a)).toBe(10); // loop back to A
});
it('rejects zero, reversed, negative and non-finite anchors', () => {
 const a={scoreStart:0,scoreEnd:10,mediaStart:2,mediaEnd:4};
 for(const patch of [{scoreEnd:0},{scoreStart:-1},{mediaEnd:1},{mediaEnd:Infinity}]) expect(validAlignment({...a,...patch})).toBe(false);
});
