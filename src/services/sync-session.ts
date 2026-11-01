let generation = 0;
let currentUserId: string | null = null;

export function setSyncIdentity(userId: string | null) {
  if (currentUserId !== userId) generation++;
  currentUserId = userId;
}

// Stop the previous account before asynchronous profile hydration can finish.
export function observeSyncAuthIdentity(userId: string | null) {
  if (currentUserId !== userId) setSyncIdentity(null);
}

// A new login, even for the same account, must not revive an old async worker.
export function captureSyncSession(userId = currentUserId) {
  const started = generation;
  return () => started === generation && Boolean(userId) && currentUserId === userId;
}

export function requireSyncSession(isCurrent: () => boolean) {
  if (!isCurrent() || !navigator.onLine) throw new Error('Progress sync paused.');
}
