import { useEffect, useMemo, useState } from 'react';
import { isActive, noteName, tuning, type Note } from './music';
import { assignFingerings, type FingeringResult } from './fingering';

export function Fretboard({ notes, time, leftHanded, originalPositions = false }: { notes: Note[]; time: number; leftHanded: boolean; originalPositions?: boolean }) {
  const [result, setResult] = useState<{ source: Note[]; value: FingeringResult } | null>(null);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [voice, setVoice] = useState(1);
  const multipleTracks = useMemo(() => new Set(notes.map(n => n.track)).size > 1, [notes]);
  useEffect(() => {
    let cancelled = false;
    setResult(null); setError(''); setVoice(1);
    if (!notes.length || multipleTracks || originalPositions) return;
    void assignFingerings(notes).then(value => { if (!cancelled) setResult({ source: notes, value }); })
      .catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [notes, multipleTracks, originalPositions, retry]);
  const current = result?.source === notes ? result.value : null;
  const positioned = originalPositions ? notes : current?.notes || [];
  const voices = [...new Set(positioned.flatMap(n => n.position ? [n.position.voice] : []))].sort((a,b) => a-b);
  const selectedVoice = voices.includes(voice) ? voice : voices[0] ?? 1;
  const displayed = positioned.filter(n => n.position?.voice === selectedVoice);
  const strings = displayed[0]?.position?.tuning || tuning;
  const capo = displayed[0]?.position?.capo || 0;
  const highestFret = displayed.reduce((max,n) => Math.max(max,n.position!.fret), 19);
  const frets = highestFret;
  const active = displayed.filter(n => isActive(n,time));
  const pos = (fret: number) => 94 + (leftHanded ? frets - fret : fret) * (946 / frets);
  const y = (string: number) => 48 + string * (145 / Math.max(1, strings.length - 1));
  const missing = originalPositions ? notes.filter(n => !n.position).length : current?.unassigned || 0;
  return <div>
    <div className="score-controls score-description">
      <span>{originalPositions ? `Gespeicherte Saitenpositionen${capo ? ` · Kapodaster ${capo}` : ''}` : 'KI-Griffzuordnung · Standardstimmung · Bünde 0–19'}</span>
      {voices.length > 1 && <label>Gitarrenstimme <select value={selectedVoice} onChange={e => setVoice(+e.target.value)}>{voices.map(v => <option key={v} value={v}>{v === 1 ? 'Hauptstimme' : `Zusätzliche Stimme ${v}`}</option>)}</select></label>}
    </div>
    {multipleTracks ? <p className="analysis-hint score-description">Bitte eine einzelne Notenspur für das Griffbrett auswählen.</p> : <>
      {!originalPositions && !current && !error && !!notes.length && <p role="status" className="score-description">Griffpositionen werden berechnet … Beim ersten Mal wird das kleine KI-Modell geladen.</p>}
      {error && <p role="alert" className="score-description">{error} <button className="button subtle small" onClick={() => setRetry(v => v + 1)}>Erneut versuchen</button></p>}
      {!!missing && <p className="analysis-hint score-description">{missing} Noten ohne darstellbare Saitenposition. Sie bleiben im Piano-Waterfall und bei der Wiedergabe erhalten.</p>}
      {!!current?.extraVoices && <p className="analysis-hint score-description">Zwei Gitarrenstimmen innerhalb dieser Spur. Wähle die Hauptstimme oder die Zusatzstimme.</p>}
      {!!current?.wideGrips && <p className="analysis-hint score-description">{current.wideGrips} weite Griffe – Spielbarkeit bitte prüfen.</p>}
      <svg className="fretboard" viewBox="0 0 1100 245" role="img" aria-label={`Gitarrengriffbrett, ${strings.length} Saiten, Bünde 0 bis ${frets}. Eine zugeordnete Position pro Note.`}>
        <rect x="63" y="32" width="1006" height="170" rx="8" fill="#252b28"/>
        {[3,5,7,9,12,15,17,19,21,24,27,29,31,33,36].filter(f => f <= frets).map(f => <circle key={f} cx={pos(f)} cy="117" r="4" fill="#455048"/>)}
        {Array.from({length:frets+1},(_,f) => <g key={f}><line x1={pos(f)+(leftHanded?-1:1)*946/frets/2} x2={pos(f)+(leftHanded?-1:1)*946/frets/2} y1="33" y2="202" stroke={f===0?'#d0cbb9':'#555e56'} strokeWidth={f===0?4:1}/><text x={pos(f)} y="230" textAnchor="middle" fill="#86938b" fontSize="12">{f===0?'0':f}</text></g>)}
        {strings.map((open,string) => <g key={string}><text x="20" y={y(string)+5} fill="#bdc7bf" fontSize="15">{noteName(open+capo)}</text><line x1="63" x2="1069" y1={y(string)} y2={y(string)} stroke="#8c9182" strokeWidth={.7+string*.3}/></g>)}
        {active.filter(n => n.position!.fret <= frets).map((n,i) => <g key={i} data-string={n.position!.string+1} data-fret={n.position!.fret}><title>{noteName(n.midi,true)} · Saite {n.position!.string+1} · Bund {n.position!.fret}</title><circle cx={pos(n.position!.fret)} cy={y(n.position!.string)} r="12" fill="#bcf782"/><text x={pos(n.position!.fret)} y={y(n.position!.string)+4} fill="#142410" textAnchor="middle" fontSize="11" fontWeight="700">{n.position!.fret}</text></g>)}
      </svg>
      {!originalPositions && current && <p className="analysis-hint score-description">Griffvorschlag aus Notenfolge und Spielbarkeit · Modell: cstr / tab-labeler v3 · CC BY 4.0. Die Originalspielweise kann abweichen.</p>}
    </>}
  </div>;
}
