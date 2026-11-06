import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Session } from './music';

export type ProjectWorkspace = {
  materialId: string | null; selectedLoopId: string | null;
  a: number | null; b: number | null; looping: boolean;
  view: 'guitar' | 'piano' | 'notation' | 'edit'; volume: number;
};
export type ProjectSnapshot = {
  format: 'loopstudio-project'; version: 1; name: string;
  media: { file: string; name: string; kind: 'audio' | 'video' };
  session: Session; workspace: ProjectWorkspace; updatedAt: number;
};
export type OpenProject = { path: string; mediaPath: string; snapshot: ProjectSnapshot; warnings: string[] };
export type RecentProject = { path: string; name: string; mediaName: string; loopCount: number; updatedAt: number };
export type NewProject = { parent: string; name: string; source: string; inheritCurrent: boolean; mediaName?: string };
export const emptyWorkspace = (): ProjectWorkspace => ({ materialId: null, selectedLoopId: null, a: null, b: null, looping: false, view: 'notation', volume: .7 });
export async function listProjects(): Promise<RecentProject[]> {
  return isTauri() ? invoke('list_projects') : [];
}
export async function openProject(path: string): Promise<OpenProject> {
  return invoke('open_project', { path });
}
export async function createProject(input: NewProject, session: Session, workspace: ProjectWorkspace): Promise<OpenProject> {
  return invoke('create_project', { parent: input.parent, name: input.name.trim(), source: input.source, mediaName: input.mediaName ?? null, session, workspace });
}
export async function saveProject(path: string, session: Session, workspace: ProjectWorkspace): Promise<void> {
  return invoke('save_project', { path, session, workspace });
}
