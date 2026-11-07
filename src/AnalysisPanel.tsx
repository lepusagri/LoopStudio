import {StemMixer} from './StemMixer';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { invoke, convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Activity, LoaderCircle, Sparkles, X } from 'lucide-react';
import { models, devices, type GlobalSettings } from './globalSettings';
import { formatTime } from './music';
import { passagePosition, stemVolume, type AnalysisResult, type StemLevel } from './analysis';

type Props = {
  player: RefObject<HTMLVideoElement | null>; nativePath?: string; blob?: Blob;
  start: number | null; end: number | null; valid: boolean; volume: number;
  practiceMode?: boolean;
  settings: GlobalSettings; settingsReady: boolean; onSettings:()=>void;
  selected: number | null; result: AnalysisResult | null;
  onResult: (result: AnalysisResult) => void; onSelect: (id: number) => void;
};
export function AnalysisPanel(props: Props) {
  const { player, result } = props;
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ message: '', percent: 0 }), [error, setError] = useState('');
  const [mixing, setMixing] = useState(false), [levels, setLevels] = useState<Record<number, StemLevel>>({});
  const {transcriber,device,modelPaths,hfToken}=props.settings;
  const modelPath=modelPaths[transcriber]??'';
  const job = useRef<string | null>(null), disposed = useRef(false);
  const mixerState = useRef({ mixing, levels, volume: props.volume });
  mixerState.current = { mixing, levels, volume: props.volume };
  useEffect(() => {
    disposed.current = false;
    if (isTauri()) void invoke<boolean>('analysis_ready').then(value => { if (!disposed.current) setReady(value); }).catch(() => {});
    return () => { disposed.current = true; if (job.current) void invoke('cancel_analysis', { jobId: job.current }).catch(() => {}); };
  }, []);

  const audioIdentity=JSON.stringify(result?[result.start,result.end,result.stems.map(s=>[s.id,s.path])]:null);
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
          if (Math.abs(element.currentTime - (position!+(stem.audioOffset??0))) > 0.09) element.currentTime = position!+(stem.audioOffset??0);
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
  }, [audioIdentity, player]);

  async function analyze() {
    if (!props.valid || props.start === null || props.end === null || busy || !props.settingsReady) return;
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
  return <><details className="analysis-card analysis-compact analysis-fold" hidden={props.practiceMode} open={!result} aria-label="Instrumente heraushören"><summary>Instrumente heraushören{busy?` · ${Math.round(progress.percent)} %`:result?' · Analyse vorhanden':''}</summary>
    <div className="analysis-heading"><div><h3>Instrumente heraushören.</h3><p>{props.valid ? `${formatTime(props.start!)} – ${formatTime(props.end!)} · ${formatTime(props.end! - props.start!)} ausgewählt` : 'Setze A und B im Player, um eine Passage zu analysieren.'}</p></div>
      <button className="button light" disabled={!ready || !props.settingsReady || !props.valid || busy || tooLong} onClick={() => void analyze()}>{busy ? <LoaderCircle size={16} className="spinner"/> : <Sparkles size={16}/>} {result ? 'Passage erneut analysieren' : 'Passage analysieren'}</button></div>
    <div className="analysis-settings-summary"><span>{props.settingsReady?`${models[transcriber]} · ${devices[device]}`:'Globale Einstellungen werden geladen …'}</span><button className="button subtle small" onClick={props.onSettings}>Einstellungen</button></div>
    {!ready && <p className="analysis-hint">{isTauri() ? 'Native Analyse noch nicht bereit. build-local.ps1 und setup-analysis.ps1 im Projektordner ausführen.' : 'Die automatische Analyse ist in der Desktop-App verfügbar.'}</p>}
    {tooLong && <p className="analysis-hint">Bitte eine Passage bis 3 Minuten wählen. Zum Einstieg sind 10–30 Sekunden sinnvoll.</p>}
    {busy && <div className="analysis-progress" role="status"><div><LoaderCircle size={16} className="spinner"/><span>{progress.message}</span><button className="button subtle small" onClick={() => void cancel()}><X size={13}/> Abbrechen</button></div><progress max="100" value={Math.max(0, progress.percent)}/><small>Berechnung auf diesem PC. Bei längeren Passagen kann das einige Minuten dauern.</small></div>}
    {error && <p className="analysis-error" role="alert">{error}</p>}
  </details>{result&&<StemMixer result={result} selected={props.selected} mixing={mixing} levels={levels} onMix={setMixing} onSelect={props.onSelect} onChange={change} selectionChanged={!!selectionChanged}/>}</>;
}
