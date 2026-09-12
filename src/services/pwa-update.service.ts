export interface PwaRegistrationOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onNeedReload?: () => void;
  onRegisterError?: (error: unknown) => void;
}

export type PwaRegister = (
  options: PwaRegistrationOptions,
) => (reloadPage?: boolean) => Promise<void>;

interface PwaUpdateState {
  available: boolean;
  applying: boolean;
}

let state: PwaUpdateState = { available: false, applying: false };
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;
let initialized = false;
const listeners = new Set<() => void>();

function publish(next: Partial<PwaUpdateState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function initializePwaUpdates(register: PwaRegister) {
  if (initialized) return;
  initialized = true;
  updateServiceWorker = register({
    immediate: true,
    onNeedRefresh: () => publish({ available: true }),
    onNeedReload: () => window.location.reload(),
    onRegisterError: () => publish({ available: false, applying: false }),
  });
}

export function subscribeToPwaUpdates(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPwaUpdateState() {
  return state;
}

export async function applyPwaUpdate() {
  if (!state.available || !updateServiceWorker || state.applying) return;
  publish({ applying: true });
  try {
    await updateServiceWorker(true);
  } catch {
    publish({ applying: false });
  }
}

export function resetPwaUpdateStateForTests() {
  state = { available: false, applying: false };
  updateServiceWorker = null;
  initialized = false;
  listeners.clear();
}
