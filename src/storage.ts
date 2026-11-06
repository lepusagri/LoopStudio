import { isTauri, invoke } from '@tauri-apps/api/core';
import type { Session } from './music';
export async function loadSessions(): Promise<Session[]> {
  const data = isTauri() ? await invoke<Session[]>('load_sessions') : JSON.parse(localStorage.getItem('loopstudio.sessions.v1') || '[]');
  if (!Array.isArray(data)) return [];
  return data.filter((s: Session) => typeof s.key === 'string' && Array.isArray(s.loops) && s.speed >= 0.25 && s.speed <= 2 && Number.isFinite(s.offset)).slice(0, 100);
}
export async function saveSessions(sessions: Session[]) {
  if (isTauri()) await invoke('save_sessions', { sessions });
  else localStorage.setItem('loopstudio.sessions.v1', JSON.stringify(sessions));
}
