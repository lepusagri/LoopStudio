import type { CloseRequestedEvent } from '@tauri-apps/api/window';

type Options = {
  transition: { current: boolean };
  hasProject: () => boolean;
  flush: () => Promise<void>;
  onBusy: (message: string) => void;
  onError: (error: unknown) => void;
};
// Tauri awaits this handler and destroys the window itself when closing is allowed.
export function closeAfterSaving(options: Options) {
  return async (event: Pick<CloseRequestedEvent, 'preventDefault'>) => {
    if (options.transition.current) { event.preventDefault(); return; }
    if (!options.hasProject()) return;
    options.transition.current = true;
    options.onBusy('Projekt wird vor dem Schließen gespeichert …');
    try { await options.flush(); }
    catch (error) { event.preventDefault(); options.onError(error); }
    finally { options.transition.current = false; options.onBusy(''); }
  };
}
