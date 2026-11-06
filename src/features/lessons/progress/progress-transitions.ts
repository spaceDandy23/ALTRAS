const pendingUnlocks = new Set<string>();

function key(userId: string, prerequisiteLessonId: string) {
  return `${userId}:${prerequisiteLessonId}`;
}

export function recordLessonUnlock(userId: string, prerequisiteLessonId: string) {
  pendingUnlocks.add(key(userId, prerequisiteLessonId));
}

export function hasPendingLessonUnlock(userId: string, prerequisiteLessonId: string) {
  return pendingUnlocks.has(key(userId, prerequisiteLessonId));
}

export function consumeLessonUnlock(userId: string, prerequisiteLessonId: string) {
  const eventKey = key(userId, prerequisiteLessonId);
  const pending = pendingUnlocks.has(eventKey);
  pendingUnlocks.delete(eventKey);
  return pending;
}

export function resetLessonUnlocks() {
  pendingUnlocks.clear();
}
