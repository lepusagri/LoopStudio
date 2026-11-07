import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, Plus, Play, Repeat2, FileAudio } from 'lucide-react';
import type { Session } from './music';
import type { NewProject, RecentProject } from './projects';
import { androidPreview } from './platform';

type Props = {
  projects: RecentProject[]; legacy: Session[]; busy: string; error: string;
  current?: { path: string; name: string }; createCurrent: number;
  onOpen: (path: string) => void; onCreate: (input: NewProject) => void;
  onDemo: () => void; onRefresh: () => void;
};
export function ProjectHome({ projects, legacy, busy, error, current, createCurrent, onOpen, onCreate, onDemo, onRefresh }: Props) {
  const [form, setForm] = useState(false), [name, setName] = useState('');
  const [source, setSource] = useState(''), [parent, setParent] = useState('');
  const [inheritCurrent, setInheritCurrent] = useState(false), [localError, setLocalError] = useState('');
  useEffect(() => {
    let active = true;
    if (isTauri()) void invoke<string>('default_project_dir').then(path => { if (active) setParent(path); }).catch(e => { if (active) setLocalError(String(e)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (createCurrent && current) { setForm(true); setInheritCurrent(true); setSource(current.path); setName(current.name.replace(/\.[^.]+$/, '')); }
  }, [createCurrent]);
  async function chooseProject() {
    try {
      const path = await open({ multiple: false, filters: [{ name: 'LoopStudio-Projekt', extensions: ['loopstudio'] }] });
      if (typeof path === 'string') onOpen(path);
    } catch (e) { setLocalError(String(e)); }
  }
  async function chooseSource() {
    try {
      const path = await open({ multiple: false, filters: [{ name: 'Audio / Video', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'mp4', 'mkv', 'webm', 'mov', 'm4v'] }] });
      if (typeof path === 'string') { setSource(path); setInheritCurrent(false); if (!name) setName(path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')); }
    } catch (e) { setLocalError(String(e)); }
  }
  async function chooseParent() {
    try {
      const path = await open({ multiple: false, directory: true, defaultPath: parent || undefined });
      if (typeof path === 'string') setParent(path);
    } catch (e) { setLocalError(String(e)); }
  }
  const old = legacy.filter(s => /^[a-z]:[\\/]/i.test(s.key) && s.loops.length > 0);
  return <main className="project-home">
    <header className="topbar"><div className="breadcrumb">Arbeitsplatz <span>/</span><strong>Projekte</strong></div><span className="privacy">DEINE MUSIK · DEINE ÜBUNGSSESSIONS</span></header>
    <div className="workspace">
      <section className="heading"><div><div className="eyebrow">DA WEITERMACHEN, WO DU AUFGEHÖRT HAST</div><h1>Deine Übungsprojekte.</h1><p>Eine Aufnahme, alle Loops und deine Noten – zusammen an einem Ort.</p></div></section>
      <div className="project-actions">
        <button className="button light" disabled={!!busy || !isTauri() || androidPreview} onClick={() => { setForm(true); setInheritCurrent(false); setSource(''); setName(''); setLocalError(''); }}><Plus size={17}/> Neues Projekt</button>
        <button className="button subtle" disabled={!!busy || !isTauri() || androidPreview} onClick={() => void chooseProject()}><FolderOpen size={17}/> Projekt öffnen</button>
        {current && <button className="button subtle" disabled={!!busy} onClick={() => { setForm(true); setSource(current.path); setName(current.name.replace(/\.[^.]+$/, '')); setInheritCurrent(true); }}>Aktuelle Session als Projekt speichern</button>}
        <button className="button subtle" disabled={!!busy} onClick={onDemo}><Play size={15}/> Demo ausprobieren</button>
      </div>
      {!isTauri() && <p className="analysis-hint">Projektordner werden in der Desktop-App gespeichert. Die Demo kannst du hier ausprobieren.</p>}
      {form && <section className="instrument-card project-create" aria-label="Projekt anlegen">
        <h2>{inheritCurrent ? 'Aktuelle Übungssession übernehmen' : 'Neues Übungsprojekt'}</h2>
        <p className="analysis-hint">Im Zielordner wird ein eigener Projektordner angelegt. Die Aufnahme wird hineinkopiert. Vorhandene Loops dieser Aufnahme werden übernommen.</p>
        <form onSubmit={e => { e.preventDefault(); onCreate({ name, source, parent, inheritCurrent }); }}>
          <label>Projektname<input required maxLength={80} value={name} disabled={!!busy} onChange={e => setName(e.target.value)}/></label>
          <label>Audio-/Videodatei<div className="project-path-control"><input required value={source} disabled={!!busy || inheritCurrent} onChange={e => setSource(e.target.value)}/><button type="button" className="button subtle" disabled={!!busy || inheritCurrent || !isTauri()} onClick={() => void chooseSource()}>Aufnahme auswählen</button></div></label>
          <label>Übergeordneter Ordner<div className="project-path-control"><input required value={parent} disabled={!!busy} onChange={e => setParent(e.target.value)}/><button type="button" className="button subtle" disabled={!!busy || !isTauri()} onClick={() => void chooseParent()}>Ordner auswählen</button></div></label>
          <div className="project-actions"><button className="button light" disabled={!!busy || !name.trim() || !source || !parent || !isTauri()}>Projekt anlegen</button><button type="button" className="button subtle" disabled={!!busy} onClick={() => setForm(false)}>Abbrechen</button></div>
        </form>
      </section>}
      {busy && <div className="notice" role="status">{busy}</div>}
      {(error || localError) && <p className="analysis-error" role="alert">{error || localError}</p>}
      <div className="project-list-heading"><h2>Zuletzt verwendet</h2><button className="button subtle" disabled={!!busy} onClick={onRefresh}>Aktualisieren</button></div>
      <div className="project-list">{projects.map(item => <button key={item.path} className="project-card" disabled={!!busy} onClick={() => onOpen(item.path)}>
        <FolderOpen size={24}/><span><strong>{item.name}</strong><small><FileAudio size={13}/> {item.mediaName} · {item.loopCount} {item.loopCount === 1 ? 'Loop' : 'Loops'}</small><small className="project-path">{item.path}</small></span><time>{new Date(item.updatedAt * 1000).toLocaleDateString('de-DE')}</time>
      </button>)}{!projects.length && <div className="project-empty"><FolderOpen size={32}/><h3>Platz für deine nächste Übung.</h3><p>Lege ein Projekt mit einer lokalen Aufnahme an oder öffne eine vorhandene Projektdatei.</p></div>}</div>
      {!!old.length && <section className="project-legacy"><h2>Bisherige Übungen übernehmen</h2><p className="analysis-hint">Deine bisherigen Loops bleiben erhalten. Wähle eine Aufnahme, um daraus ein vollständiges Projekt anzulegen.</p>{old.map(session => <button key={session.key} className="project-card" disabled={!!busy} onClick={() => { setForm(true); setInheritCurrent(false); setSource(session.key); setName(session.key.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')); }}><Repeat2 size={20}/><span><strong>{session.key.split(/[\\/]/).pop()}</strong><small>{session.loops.length} Loops · {session.key}</small></span><span>Als Projekt übernehmen</span></button>)}</section>}
      <p className="analysis-hint project-footnote">Ein Projekt enthält eine .loopstudio-Datei und die zugehörigen Medien- und Notenordner. Zum Verschieben oder Sichern den gesamten Projektordner mitnehmen. Änderungen im Übungsraum werden automatisch gespeichert.</p>
    </div>
  </main>;
}
