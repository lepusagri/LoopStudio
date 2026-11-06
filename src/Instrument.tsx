import { useEffect, useRef } from 'react';
import { isActive, noteName, tuning, type Note } from './music';

export function Fretboard({ notes, time, leftHanded }: { notes: Note[]; time: number; leftHanded: boolean }) {
  const active = new Set(notes.filter(note => isActive(note, time)).map(note => note.midi));
  return <svg className="fretboard" viewBox="0 0 1100 245" role="img" aria-label="Gitarrengriffbrett in Standardstimmung, Bünde 0 bis 15. Alle Positionen der aktiven Töne.">
    <rect x="63" y="32" width="1006" height="170" rx="8" fill="#252b28"/>
    {[3, 5, 7, 9, 12, 15].map(fret => <g key={fret}>{(fret === 12 ? [83, 151] : [117]).map(y => <circle key={y} cx={pos(fret, leftHanded)} cy={y} r="5" fill="#455048"/>)}</g>)}
    {Array.from({ length: 16 }, (_, fret) => <g key={fret}><line x1={pos(fret, leftHanded) + (leftHanded ? -31 : 31)} x2={pos(fret, leftHanded) + (leftHanded ? -31 : 31)} y1="33" y2="202" stroke={fret === 0 ? '#d0cbb9' : '#555e56'} strokeWidth={fret === 0 ? 5 : 1.3}/><text x={pos(fret, leftHanded)} y="230" textAnchor="middle" fill="#86938b" fontSize="12">{fret === 0 ? 'Offen' : fret}</text></g>)}
    {tuning.map((open, string) => <g key={open}>
      <text x="20" y={53 + string * 29} fill="#bdc7bf" fontSize="15">{noteName(open)}</text>
      <line x1="63" x2="1069" y1={48 + string * 29} y2={48 + string * 29} stroke="#8c9182" strokeWidth={0.7 + string * 0.35}/>
      {Array.from({ length: 16 }, (_, fret) => active.has(open + fret) && <g key={fret}><circle cx={pos(fret, leftHanded)} cy={48 + string * 29} r="12" fill="#bcf782"/><text x={pos(fret, leftHanded)} y={52 + string * 29} fill="#142410" textAnchor="middle" fontSize="10" fontWeight="700">{noteName(open + fret)}</text></g>)}
    </g>)}
  </svg>;
}
function pos(fret: number, left: boolean) { return 94 + (left ? 15 - fret : fret) * 62.8; }

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
      const min = 36, max = 96;
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
  return <canvas ref={ref} className="waterfall" role="img" aria-label="Fallende Klaviernoten, fünf Sekunden Vorschau, Tastatur C2 bis C7"/>;
}
