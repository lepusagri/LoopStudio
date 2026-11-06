import { peaksFrom } from './music';

const limit = 200 * 1024 * 1024;
/** The existing Web Audio waveform decoder, shared by dropped files and native media URLs. */
export async function readWaveform(source: Blob | string, signal: AbortSignal): Promise<number[]> {
  if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
  let file: Blob;
  if (typeof source === 'string') {
    const response = await fetch(source, { signal });
    if (!response.ok) throw new Error('Die Aufnahme konnte für die Wellenform nicht gelesen werden.');
    if (Number(response.headers.get('content-length')) > limit) throw new Error('Wellenform bei Dateien bis 200 MB.');
    file = await response.blob();
  } else file = source;
  if (file.size > limit) throw new Error('Wellenform bei Dateien bis 200 MB.');
  if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
  const context = new AudioContext();
  const close = () => { void context.close().catch(() => {}); };
  signal.addEventListener('abort', close, { once: true });
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    return peaksFrom(buffer.getChannelData(0));
  } finally {
    signal.removeEventListener('abort', close);
    if (context.state !== 'closed') await context.close();
  }
}
