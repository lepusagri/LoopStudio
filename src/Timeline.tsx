import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { formatTime, validLoop } from './music';
import { moveMarker, pointerTime, type Range } from './timelineRange';

type Props = Range & {
  peaks: number[]; duration: number; time: number; looping: boolean; waveState: string; disabled: boolean;
  onSeek: (time: number) => void; onRange: (range: Range) => void;
};
type Drag = { pointer: number; marker: 'a' | 'b'; range: Range };
export function Timeline({ peaks, duration, time, a, b, looping, waveState, disabled, onSeek, onRange }: Props) {
  const waveform = useRef<HTMLDivElement>(null), dragging = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<Range | null>(null);
  useEffect(() => { dragging.current = null; setPreview(null); }, [a, b, duration, disabled]);
  const range = preview ?? { a, b }, valid = validLoop(range.a, range.b, duration);
  function at(event: PointerEvent) {
    const box = waveform.current!.getBoundingClientRect();
    return pointerTime(event.clientX, box.left, box.width, duration);
  }
  function move(event: PointerEvent<HTMLButtonElement>, finish = false) {
    const drag = dragging.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    const next = moveMarker(drag.range, drag.marker, at(event), duration);
    if (finish) {
      dragging.current = null; setPreview(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (next.a !== a || next.b !== b) onRange(next);
    } else setPreview(next);
  }
  return <div className="timeline-wrap">
    <div className="time-labels"><span>{formatTime(time)}</span><span>{preview ? `${formatTime(range.a ?? 0)} – ${formatTime(range.b ?? duration)}` : waveState || (looping && valid ? `Loop · ${formatTime(range.b! - range.a!)}` : 'DEINE PASSAGE IM BLICK')}</span><span>{formatTime(duration)}</span></div>
    <div className="waveform" ref={waveform}>
      <svg viewBox="0 0 1000 62" preserveAspectRatio="none" aria-hidden="true">{peaks.length ? peaks.map((peak, i) => <rect key={i} x={i / peaks.length * 1000} y={31 - Math.max(1, peak * 27)} width={1000 / peaks.length * .65} height={Math.max(2, peak * 54)} rx="0.5" fill={i / peaks.length <= time / (duration || 1) ? '#bbef8d' : '#455e50'}/>) : <line x1="0" x2="1000" y1="31" y2="31" stroke="#455e50" strokeWidth="2"/>}</svg>
      {valid && <div className="loop-region" style={{ left: `${range.a! / duration * 100}%`, width: `${(range.b! - range.a!) / duration * 100}%` }}/>}
      <div className="playhead" style={{ left: `${time / (duration || 1) * 100}%` }}/>
      <input className="seek" aria-label="Wiedergabeposition" type="range" min="0" max={duration || 1} step="0.01" value={Math.min(time, duration || 1)} onChange={event => onSeek(+event.target.value)}/>
      {(['a', 'b'] as const).map(marker => range[marker] !== null && <button key={marker} type="button" role="slider" className={`loop-marker ${marker === 'b' ? 'b-marker' : ''}`} aria-label={marker === 'a' ? 'Loop-Anfang A verschieben' : 'Loop-Ende B verschieben'} aria-valuemin={marker === 'a' ? 0 : (a ?? 0) + .1} aria-valuemax={marker === 'b' ? duration : (b ?? duration) - .1} aria-valuenow={range[marker]!} aria-valuetext={formatTime(range[marker]!)} title={`${marker.toUpperCase()} · ${formatTime(range[marker]!)} · mit der Maus ziehen`} disabled={disabled || duration < .1}
        style={{ left: `${range[marker]! / (duration || 1) * 100}%` }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = { pointer: event.pointerId, marker, range: { a, b } }; setPreview({ a, b });
        }} onPointerMove={event => move(event)} onPointerUp={event => move(event, true)}
        onPointerCancel={() => { dragging.current = null; setPreview(null); }} onLostPointerCapture={() => { dragging.current = null; setPreview(null); }}
        onKeyDown={event => {
          const current = range[marker]!;
          if (event.key === 'Escape') { event.stopPropagation(); dragging.current = null; setPreview(null); return; }
          const target = event.key === 'Home' ? 0 : event.key === 'End' ? duration : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? current - (event.shiftKey ? 1 : .1) : ['ArrowRight', 'ArrowUp'].includes(event.key) ? current + (event.shiftKey ? 1 : .1) : null;
          if (target === null) return;
          event.preventDefault(); event.stopPropagation(); onRange(moveMarker({ a, b }, marker, target, duration));
        }}><span>{marker.toUpperCase()}</span></button>)}
    </div>
  </div>;
}
