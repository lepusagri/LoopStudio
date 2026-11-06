import { useEffect, useRef, useState, type RefObject } from 'react';
import { invoke, convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { Activity, LoaderCircle, Sparkles, X } from 'lucide-react';
import { formatTime } from './music';
import { passagePosition, stemVolume, type AnalysisResult, type StemLevel } from './analysis';

type Props = {
  player: RefObject<HTMLVideoElement | null>; nativePath?: string; blob?: Blob;
  start: number | null; end: number | null; valid: boolean; volume: number;
  selected: number | null; result: AnalysisResult | null;
  onResult: (result: AnalysisResult) => void; onSelect: (id: number) => void;
};
export function AnalysisPanel(props: Props) {
  const { player, result } = props;
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ message: '', percent: 0 }), [error, setError] = useState('');
  const [mixing, setMixing] = useState(false), [levels, setLevels] = useState<Record<number, StemLevel>>({});
  const [transcriber, setTranscriber] = useState('basic-pitch'), [device, setDevice] = useState('auto');
  const [modelPath, setModelPath] = useState(''), [hfToken, setHfToken] = useState('');
  const job = useRef<string | null>(null), disposed = useRef(false);
  const mixerState = useRef({ mixing, levels, volume: props.volume });
  mixerState.current = { mixing, levels, volume: props.volume };
  useEffect(() => {
    disposed.current = false;
    if (isTauri()) void invoke<boolean>('analysis_ready').then(value => { if (!disposed.current) setReady(value); }).catch(() => {});
    return () => { disposed.current = true; if (job.current) void invoke('cancel_analysis', { jobId: job.current }).catch(() => {}); };
  }, []);

  useEffect(() => {
    if (!result) return;
    const video = player.current;
    const audio = result.stems.map(stem => {
      const element = new Audio(convertFileSrc(stem.path)); element.preload = 'auto'; element.preservesPitch = true;
      element.onerror = () => { setMixing(false); setError(`Die Audiospur ${stem.name} konnte nicht geladen werden. Bitte erneut analysieren.`); };
      return { stem, element, pending: false };
    });
    let frame = 0, closed = false;
    const tick = () => {
      if (!video || closed) return;
      const { mixing: enabled, levels: gains, volume } = mixerState.current;
      const position = passagePosition(video.currentTime, result.start, result.end);
      const inMix = enabled && position !== null;
      video.muted = inMix;
      const anySolo = Object.values(gains).some(g => g.solo);
      audio.forEach(item => {
        const { element, stem } = item;
        const gain = gains[stem.id] || { muted: false, solo: false, volume: 1 };
        element.volume = stemVolume(gain, anySolo, volume);
        if (element.playbackRate !== video.playbackRate) element.playbackRate = video.playbackRate;
        if (!inMix || video.paused || video.seeking || video.readyState < 3) { element.pause(); }
        else if (element.readyState >= 2) {
          if (Math.abs(element.currentTime - position!) > 0.09) element.currentTime = position!;
          if (element.paused && !item.pending) {
            item.pending = true;
            void element.play().catch(e => {
              if (!closed && e.name !== 'AbortError') { setMixing(false); setError('Spurwiedergabe konnte nicht starten. Bitte erneut auf Abspielen klicken.'); }
            }).finally(() => { item.pending = false; if (closed) element.pause(); });
          }
        }
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { closed = true; cancelAnimationFrame(frame); audio.forEach(({ element }) => { element.pause(); element.removeAttribute('src'); element.load(); }); if (video) video.muted = false; };
  }, [result, player]);

  async function analyze() {
    if (!props.valid || props.start === null || props.end === null || busy) return;
    const id = crypto.randomUUID(); job.current = id;
    setBusy(true); setError(''); setProgress({ message: 'Analyse vorbereiten …', percent: 0 });
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<{ jobId: string; message: string; percent: number }>('analysis-progress', event => {
        if (!disposed.current && event.payload.jobId === id) setProgress(event.payload);
      });
      let source = props.nativePath;
      if (!source && props.blob) {
        if (props.blob.size > 512 * 1024 * 1024) throw new Error('Bitte diese große Datei über „Datei öffnen“ auswählen.');
        source = await invoke<string>('stage_media', await props.blob.arrayBuffer());
      }
      if (!source) throw new Error('Bitte eine lokale Audio- oder Videodatei öffnen.');
      if (disposed.current || job.current !== id) return;
      const data = await invoke<AnalysisResult>('analyze_passage', { source, start: props.start, end: props.end, jobId: id, options: { transcriber, device, modelPath: modelPath || null, hfToken: hfToken || null } });
      if (disposed.current || job.current !== id) return;
      setLevels(Object.fromEntries(data.stems.map(stem => [stem.id, { muted: false, solo: false, volume: 1 }])));
      setMixing(false); props.onResult(data);
    } catch (e) { if (!disposed.current) setError(String(e)); }
    finally { unlisten?.(); job.current = null; if (!disposed.current) setBusy(false); }
  }
  async function cancel() {
    const id = job.current; if (!id) return;
    job.current = null;
    setProgress({ message: 'Analyse wird abgebrochen …', percent: 0 });
    try { await invoke('cancel_analysis', { jobId: id }); } catch (e) { setError(String(e)); }
  }
  function change(id: number, patch: Partial<StemLevel>) {
    setLevels(previous => ({ ...previous, [id]: { ...(previous[id] || { muted: false, solo: false, volume: 1 }), ...patch } }));
  }
  const tooLong = props.start !== null && props.end !== null && props.end - props.start > 180;
  const selectionChanged = result && (props.start !== result.start || Math.abs((props.end ?? 0) - result.end) > 0.05);
  return <section className="analysis-card" aria-label="Passage analysieren und Spuren mischen">
    <div className="analysis-heading"><div><div className="eyebrow"><Activity size={14}/> DEINE PASSAGE, IN EINZELNEN SPUREN</div><h3>Instrumente heraushören.</h3><p>{props.valid ? `${formatTime(props.start!)} – ${formatTime(props.end!)} · ${formatTime(props.end! - props.start!)} ausgewählt` : 'Setze A und B im Player, um eine Passage zu analysieren.'}</p></div>
      <button className="button light" disabled={!ready || !props.valid || busy || tooLong} onClick={() => void analyze()}>{busy ? <LoaderCircle size={16} className="spinner"/> : <Sparkles size={16}/>} {result ? 'Passage erneut analysieren' : 'Passage analysieren'}</button></div>
    <div className="score-controls">
      <label>Notenerkennung <select disabled={busy} value={transcriber} onChange={e=>{setTranscriber(e.target.value);setModelPath('');}}><option value="basic-pitch">Basic Pitch</option><option value="muscriptor-small">MuScriptor Small · 0,41 GB</option><option value="muscriptor-medium">MuScriptor Medium · 1,23 GB</option><option value="muscriptor-large">MuScriptor Large · 5,47 GB</option></select></label>
      <label>Berechnung <select disabled={busy} value={device} onChange={e=>setDevice(e.target.value)}><option value="auto">Automatisch · Intel Arc bevorzugen</option><option value="cpu">CPU</option><option value="openvino">Intel-GPU · OpenVINO</option></select></label>
      <span>Native Rust-Analyse · Demucs trennt sechs Spuren</span>
    </div>
    {transcriber !== 'basic-pitch' && <div className="score-controls">
      <button className="button subtle small" disabled={busy} onClick={async()=>{try{const path=await open({multiple:false,filters:[{name:'MuScriptor-Modell',extensions:['safetensors']}]});if(typeof path==='string')setModelPath(path);}catch(e){setError(String(e));}}}>Lokales Modell wählen</button>
      <span>{modelPath || 'Vorhandenen Modellcache nutzen oder beim ersten Mal laden'}</span>
      {modelPath && <button className="button subtle small" disabled={busy} onClick={()=>setModelPath('')}>Modellcache verwenden</button>}
      <label>Hugging-Face-Token <input type="password" autoComplete="off" disabled={busy} value={hfToken} onChange={e=>setHfToken(e.target.value)} placeholder="Optional · nur für diese Sitzung"/></label>
      <p className="analysis-hint">MuScriptor benötigt freigeschalteten Modellzugang bei Hugging Face (CC BY-NC 4.0). Ein vorhandener Login oder eine lokale Modelldatei kann verwendet werden. Das Modell wird pro Instrumentenspur angewendet; längere Passagen können entsprechend dauern.</p>
    </div>}
    {!ready && <p className="analysis-hint">{isTauri() ? 'Native Analyse noch nicht bereit. build-local.ps1 und setup-analysis.ps1 im Projektordner ausführen.' : 'Die automatische Analyse ist in der Desktop-App verfügbar.'}</p>}
    {tooLong && <p className="analysis-hint">Bitte eine Passage bis 3 Minuten wählen. Zum Einstieg sind 10–30 Sekunden sinnvoll.</p>}
    {busy && <div className="analysis-progress" role="status"><div><LoaderCircle size={16} className="spinner"/><span>{progress.message}</span><button className="button subtle small" onClick={() => void cancel()}><X size={13}/> Abbrechen</button></div><progress max="100" value={Math.max(0, progress.percent)}/><small>Berechnung auf diesem PC. Bei längeren Passagen kann das einige Minuten dauern.</small></div>}
    {error && <p className="analysis-error" role="alert">{error}</p>}
    {result && <><div className="mix-heading"><div><strong>Spurmixer</strong><small>Analyse{result.engine === 'rust' ? ` · Rust · ${result.transcriber || ''} · ${result.device || ''}` : ''}: {formatTime(result.start)} – {formatTime(result.end)}{selectionChanged ? ' · andere Passage als aktuelle A/B-Auswahl' : ''}</small></div><div className="tabs"><button className={!mixing ? 'active' : ''} onClick={() => setMixing(false)}>Original</button><button className={mixing ? 'active' : ''} onClick={() => setMixing(true)}>Spuren hören</button></div></div>
      <div className="stem-grid">{result.stems.map(stem => {
        const level = levels[stem.id] || { muted: false, solo: false, volume: 1 };
        return <div key={stem.id} className={`stem-row ${props.selected === stem.id ? 'chosen' : ''}`}>
          <button className="stem-name" onClick={() => props.onSelect(stem.id)} aria-pressed={props.selected === stem.id}><span className={`stem-dot ${stem.source}`}/><span><strong>{stem.name}</strong><small>{stem.notes.length} Noten{stem.source === 'drums' ? ' · Rhythmusspur' : ''}</small></span></button>
          <button className={`mix-button ${level.muted ? 'on' : ''}`} aria-label={`${stem.name} stummschalten`} aria-pressed={level.muted} onClick={() => { change(stem.id, { muted: !level.muted }); setMixing(true); }}>M</button>
          <button className={`mix-button ${level.solo ? 'on' : ''}`} aria-label={`${stem.name} solo hören`} aria-pressed={level.solo} onClick={() => { change(stem.id, { solo: !level.solo }); setMixing(true); }}>S</button>
          <input type="range" aria-label={`Lautstärke ${stem.name}`} min="0" max="1" step="0.01" value={level.volume} onChange={e => { change(stem.id, { volume: +e.target.value }); setMixing(true); }}/>
        </div>;
      })}</div>
      <p className="analysis-hint">Instrument anklicken → Noten unten anzeigen. M = stumm · S = solo. Außerhalb der analysierten Passage hörst du das Original.</p>
      {result.stems.find(s => s.id === props.selected)?.warning && <p className="analysis-hint">{result.stems.find(s => s.id === props.selected)?.warning}</p>}
    </>}
    <p className="analysis-footnote">Demucs · 6 Instrumentenspuren · Automatisch erkannte Noten sind eine Übungshilfe und können Fehler enthalten, besonders bei Piano und dichtem Zusammenspiel.</p>
  </section>;
}
