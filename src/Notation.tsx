import { useEffect, useRef, useState } from 'react';
import type { AlphaTabApi } from '@coderline/alphatab';
import type { ScoreDocument } from './ScoreStudio';
import type { Note } from './music';

export function Notation({ doc, track, notes, time }: { doc: ScoreDocument; track: number; notes: Note[]; time: number }) {
  const host = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null);
  const api = useRef<AlphaTabApi | null>(null), loaded = useRef(false), position = useRef(time);
  const sync = useRef<() => void>(() => {});
  position.current = time;
  const [error, setError] = useState(''), [staff, setStaff] = useState('tab');
  const singleTrack = track >= 0 || doc.tracks.length === 1;

  useEffect(() => {
    let disposed = false, scrollFrame = 0;
    loaded.current = false; setError('');
    if (!singleTrack) return;
    void import('@coderline/alphatab').then(at => {
      if (disposed || !host.current || !viewport.current) return;
      viewport.current.scrollLeft = 0;
      const instance = new at.AlphaTabApi(host.current, {
        core: { useWorkers: false, fontDirectory: '/fonts/' },
        display: { layoutMode: at.LayoutMode.Horizontal, staveProfile: doc.gp && staff === 'tab' ? at.StaveProfile.Tab : at.StaveProfile.Score, scale: .9, padding: [12, 12, 12, 12] },
        player: { playerMode: at.PlayerMode.EnabledExternalMedia, enableCursor: true, enableElementHighlighting: true, enableUserInteraction: false, scrollElement: viewport.current, scrollMode: at.ScrollMode.Continuous, scrollOffsetX: -80, scrollSpeed: 0 },
        notation: { elements: new Map([at.NotationElement.ScoreTitle, at.NotationElement.ScoreSubTitle, at.NotationElement.ScoreArtist, at.NotationElement.ScoreAlbum, at.NotationElement.ScoreWords, at.NotationElement.ScoreMusic, at.NotationElement.ScoreWordsAndMusic, at.NotationElement.ScoreCopyright].map(element => [element, false])) }
      });
      api.current = instance;
      const update = () => {
        if (disposed || !loaded.current) return;
        // External-media mode only supplies the cursor. The existing player owns audio
        // and seconds, including its seek, loop and recording-alignment behavior.
        instance.timePosition = Math.max(0, position.current) * 1000;
        // alphaTab places the cursor asynchronously after a position event.
        cancelAnimationFrame(scrollFrame);
        scrollFrame = requestAnimationFrame(() => { if (!disposed) instance.scrollToCursor(); });
      };
      sync.current = update;
      instance.error.on(e => { if (!disposed) setError(String(e)); });
      instance.midiLoaded.on(() => { loaded.current = true; update(); });
      instance.renderFinished.on(update);
      if (doc.gp) instance.load(new Uint8Array(doc.gp), [track < 0 ? doc.tracks[0].id : track]);
      else {
        const names = ['c','c#','d','d#','e','f','f#','g','g#','a','a#','b'];
        const step = 60 / (doc.bpm || 120) / 4;
        const cells = Array.from({ length: Math.min(4096, Math.ceil(doc.duration / step)) }, (_, i) => {
          const pitches = [...new Set(notes.filter(n => n.time < (i + 1) * step && n.time + n.duration > i * step).map(n => n.midi))];
          const token = pitches.length ? '(' + pitches.map(p => names[p % 12] + (Math.floor(p / 12) - 1)).join(' ') + ').16' : 'r.16';
          return token + (i % 16 === 15 ? ' |' : '');
        });
        instance.tex('\\tempo ' + (doc.bpm || 120) + ' . ' + cells.join(' '));
      }
    }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; cancelAnimationFrame(scrollFrame); sync.current = () => {}; loaded.current = false; api.current?.destroy(); api.current = null; };
  }, [doc, track, notes, staff, singleTrack]);

  useEffect(() => {
    sync.current();
  }, [time]);

  return <>
    <div className="score-controls">
      {doc.gp && <label>Zeile <select value={staff} onChange={e => setStaff(e.target.value)}><option value="tab">Tabulatur</option><option value="score">Noten</option></select></label>}
      <span>Eine Zeile · folgt der Wiedergabe · horizontal scrollbar</span>
    </div>
    {!singleTrack && <p className="analysis-hint score-description">Bitte eine einzelne Notenspur für die Notenzeile auswählen.</p>}
    {!doc.gp && <p className="analysis-hint score-description">MIDI: vereinfachte 1/16-Quantisierung, maximal 256 Takte.</p>}
    {error && <p className="score-description" role="alert">{error}</p>}
    {singleTrack && <div className="notation-viewport" ref={viewport} aria-label="Scrollende Notenzeile"><div className="notation-sheet" ref={host}/></div>}
  </>;
}
