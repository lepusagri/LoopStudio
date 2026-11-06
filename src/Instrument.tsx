import { useEffect, useRef } from 'react';
import { isActive, noteName, type Note } from './music';
export { Fretboard } from './Fretboard';

export function Waterfall({ notes, time, playing }: { notes: Note[]; time: number; playing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (!width || !height) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr; canvas.height = height * dpr; ctx.scale(dpr, dpr);
      ctx.fillStyle = '#141a18'; ctx.fillRect(0, 0, width, height);
      const strike = height - 68;
      const range = notes.reduce(([lo, hi], n) => [Math.min(lo, n.midi), Math.max(hi, n.midi)], [36, 96]);
      const min = Math.max(0, Math.floor(range[0] / 12) * 12), max = Math.min(127, Math.ceil(range[1] / 12) * 12);
      const white = (m: number) => ![1, 3, 6, 8, 10].includes(m % 12);
      const keys = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      const whites = keys.filter(white);
      const w = width / whites.length;
      const xOf = (m: number) => white(m) ? whites.indexOf(m) * w : (whites.filter(k => k < m).length - 0.3) * w;
      const active = new Set(notes.filter(n => isActive(n, time)).map(n => n.midi));
      ctx.font = '10px system-ui';
      whites.forEach(m => {
        const x = xOf(m);
        ctx.strokeStyle = m % 12 === 0 ? '#344039' : '#202a25'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, strike); ctx.stroke();
      });
      for (let s = 0; s < 6; s++) {
        const y = strike - (s - time % 1) * (strike / 5);
        ctx.strokeStyle = '#26322b'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
      notes.forEach(note => {
        if (note.midi < min || note.midi > max || note.time > time + 5 || note.time + note.duration < time) return;
        const y = strike - (note.time + note.duration - time) * strike / 5;
        const end = Math.min(strike, strike - (note.time - time) * strike / 5);
        const top = Math.max(0, y), h = end - top;
        if (h <= 0) return;
        ctx.fillStyle = isActive(note, time) ? '#d6ffaf' : white(note.midi) ? '#99cc72' : '#69aa80';
        ctx.beginPath(); ctx.roundRect(xOf(note.midi) + 2, top, Math.max(2, w * (white(note.midi) ? 1 : 0.6) - 4), Math.max(2, h), 4); ctx.fill();
      });
      whites.forEach(m => {
        const x = xOf(m); ctx.fillStyle = active.has(m) ? '#bcf782' : '#e5e8df'; ctx.fillRect(x + 1, strike, w - 2, 66);
        if (m % 12 === 0) { ctx.fillStyle = '#556053'; ctx.fillText(noteName(m, true), x + 3, height - 8); }
      });
      keys.filter(m => !white(m)).forEach(m => { ctx.fillStyle = active.has(m) ? '#83c94b' : '#28312b'; ctx.fillRect(xOf(m), strike, w * 0.6, 40); });
      ctx.fillStyle = '#bcf782'; ctx.fillRect(0, strike - 2, width, 2);
      if (!notes.length) { ctx.fillStyle = '#a0afa4'; ctx.font = '14px system-ui'; ctx.textAlign = 'center'; ctx.fillText('Keine Noten in dieser Spur · Analyse oder MIDI / GP5 laden', width / 2, strike / 2); }
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas);
    return () => observer.disconnect();
  }, [notes, time, playing]);
  return <><p className="analysis-hint score-description">Originaltonhöhen der gewählten Notenspur · fünf Sekunden Vorschau · keine zusätzlichen Oktavlagen</p><canvas ref={ref} className="waterfall" role="img" aria-label="Fallende Klaviernoten der gewählten Spur, fünf Sekunden Vorschau"/></>;
}
