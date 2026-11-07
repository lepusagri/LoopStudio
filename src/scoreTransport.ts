export type Alignment = { scoreStart: number; scoreEnd: number; mediaStart: number; mediaEnd: number };
export function validAlignment(a: Alignment) {
  return Object.values(a).every(Number.isFinite) && a.scoreStart >= 0 && a.mediaStart >= 0 && a.scoreEnd - a.scoreStart >= .1 && a.mediaEnd - a.mediaStart >= .1;
}
export function mappedTime(time: number, a: Alignment) {
  return a.scoreStart + (time - a.mediaStart) * (a.scoreEnd - a.scoreStart) / (a.mediaEnd - a.mediaStart);
}

export function alignmentForPractice(alignment:Alignment|null,a:number|null,b:number|null):Alignment|null {
  if(!alignment||!validAlignment(alignment)||a===null||b===null||Math.abs(alignment.mediaStart-a)>.01||Math.abs(alignment.mediaEnd-b)>.06)return null;
  return alignment;
}
