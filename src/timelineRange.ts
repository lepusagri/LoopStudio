export type Range = { a: number | null; b: number | null };
export function moveMarker(range: Range, marker: 'a' | 'b', value: number, duration: number): Range {
  if (!Number.isFinite(value) || !Number.isFinite(duration) || duration < .1) return range;
  const min = marker === 'a' ? 0 : (range.a ?? 0) + .1;
  const max = marker === 'b' ? duration : (range.b ?? duration) - .1;
  const bounded = Math.max(min, Math.min(max, Math.round(value * 100) / 100));
  return { ...range, [marker]: bounded };
}
export function pointerTime(clientX: number, left: number, width: number, duration: number): number {
  if (width <= 0 || !Number.isFinite(width)) return 0;
  return Math.max(0, Math.min(duration, (clientX - left) / width * duration));
}
