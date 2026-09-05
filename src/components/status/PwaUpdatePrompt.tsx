import { useSyncExternalStore } from 'react';
import {
  applyPwaUpdate,
  getPwaUpdateState,
  subscribeToPwaUpdates,
} from '@/services/pwa-update.service';

export function PwaUpdatePrompt() {
  const state = useSyncExternalStore(
    subscribeToPwaUpdates,
    getPwaUpdateState,
    getPwaUpdateState,
  );
  if (!state.available) return null;
  return (
    <aside className="pwa-update-prompt" role="status" aria-live="polite">
      <span>An ALTRAS update is ready.</span>
      <button type="button" disabled={state.applying} onClick={() => void applyPwaUpdate()}>
        {state.applying ? 'Updating…' : 'Reload to update'}
      </button>
    </aside>
  );
}
