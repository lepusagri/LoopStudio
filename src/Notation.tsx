import { useEffect, useRef, useState } from 'react';
import type { AlphaTabApi } from '@coderline/alphatab';
import type { ScoreDocument } from './ScoreStudio';
import type { Note } from './music';
import { notationTex } from './notationData';
import { assignFingerings } from './fingering';

export function Notation({ doc, track, notes, time }: { doc: ScoreDocument; track: number; notes: Note[]; time: number }) {
  const host = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null);
  const api = useRef<AlphaTabApi | null>(null), loaded = useRef(false), position = useRef(time);
  const sync = useRef<() => void>(() => {});
  position.current = time;
  const [error, setError] = useState(''), [staff, setStaff] = useState(notes.some(n=>n.position)?'tab':'score');
  const [voices,setVoices]=useState<number[]>([]),[voice,setVoice]=useState(1);
  const singleTrack = track >= 0 || doc.tracks.length === 1;

  useEffect(() => {
    let disposed = false, scrollFrame = 0;
    loaded.current = false; setError('');
    if (!singleTrack) return;
    void import('@coderline/alphatab').then(async at => {
      if (disposed || !host.current || !viewport.current) return;
      let renderedNotes=notes;
      if(staff==='tab' && !(doc.gp&&!doc.edited)) {
        if(notes.some(n=>!n.position)) renderedNotes=(await assignFingerings(notes)).notes;
        if(disposed||!host.current||!viewport.current)return;
        const choices=[...new Set(renderedNotes.flatMap(n=>n.position?[n.position.voice]:[]))].sort((a,b)=>a-b);
        setVoices(choices);
        if(choices.length&&!choices.includes(voice)){setVoice(choices[0]);return;}
        // Each additional guitar is a separate playable line.
        renderedNotes=renderedNotes.filter(n=>!n.position||n.position.voice===voice);
      } else setVoices([]);
      viewport.current.scrollLeft = 0;
      const instance = new at.AlphaTabApi(host.current, {
        core: { useWorkers: false, fontDirectory: '/fonts/' },
        display: { layoutMode: at.LayoutMode.Horizontal, staveProfile: staff === 'tab' && (!doc.gp || notes.some(n=>n.position)) ? at.StaveProfile.Tab : at.StaveProfile.Score, scale: .9, padding: [12, 12, 12, 12] },
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
      if (doc.gp && !doc.edited) instance.load(new Uint8Array(doc.gp), [track < 0 ? doc.tracks[0].id : track]);
      else instance.tex(notationTex(renderedNotes,doc.bpm,doc.duration,staff==='tab'));
    }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; cancelAnimationFrame(scrollFrame); sync.current = () => {}; loaded.current = false; api.current?.destroy(); api.current = null; };
  }, [doc, track, notes, staff, singleTrack, voice]);

  useEffect(() => {
    sync.current();
  }, [time]);

  return <>
    <div className="score-controls">
      {<label>Zeile <select value={staff} onChange={e => setStaff(e.target.value)}><option value="tab">Tabulatur</option><option value="score">Noten</option></select></label>}
      {staff==='tab'&&voices.length>1&&<label>Gitarrenstimme <select value={voice} onChange={e=>setVoice(+e.target.value)}>{voices.map(v=><option key={v} value={v}>{v===1?'Hauptstimme':`Zusätzliche Stimme ${v}`}</option>)}</select></label>}
      <span>Eine Zeile · folgt der Wiedergabe · horizontal scrollbar</span>
    </div>
    {!singleTrack && <p className="analysis-hint score-description">Bitte eine einzelne Notenspur für die Notenzeile auswählen.</p>}
    {(!doc.gp||doc.edited)&&<p className="analysis-hint score-description">{doc.edited?'Bearbeitete Loop-Fassung':'MIDI / Analyse'} · vereinfachte 1/16-Notation bei {doc.bpm} BPM, maximal 256 Takte. Klang und Zeitpositionen folgen den gespeicherten Notenwerten.</p>}
    {error && <p className="score-description" role="alert">{error}</p>}
    {singleTrack && <div className="notation-viewport" ref={viewport} aria-label="Scrollende Notenzeile"><div className="notation-sheet" ref={host}/></div>}
  </>;
}
