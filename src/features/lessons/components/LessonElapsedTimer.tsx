import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';

export function lessonTimerStorageKey(userId: string, lessonId: string, attemptId: string) {
  return `altras:lesson-time:${encodeURIComponent(userId)}:${encodeURIComponent(lessonId)}:${encodeURIComponent(attemptId)}`;
}

function readElapsed(storageKey: string): number | null {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === null) return null;
    const elapsed = Number(saved);
    return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
  } catch {
    return null;
  }
}

function saveElapsed(storageKey: string, elapsedMs: number) {
  try {
    window.localStorage.setItem(storageKey, String(Math.max(0, Math.floor(elapsedMs))));
  } catch {
    // The live display continues if browser storage is unavailable.
  }
}

function formatElapsed(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function LessonElapsedTimer({
  startedAt,
  stoppedAt,
  storageKey,
}: {
  startedAt: number | null | undefined;
  stoppedAt?: number | null;
  storageKey?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [activeElapsed, setActiveElapsed] = useState(() => ({
    storageKey,
    milliseconds: storageKey ? (readElapsed(storageKey) ?? 0) : 0,
  }));

  useEffect(() => {
    if (!startedAt) return;
    if (storageKey) {
      const saved = readElapsed(storageKey);
      if (stoppedAt) {
        return;
      }

      let elapsed = saved ?? 0;
      let segmentStartedAt = document.visibilityState === 'visible' ? Date.now() : null;
      const checkpoint = () => {
        const current = elapsed + (segmentStartedAt === null ? 0 : Date.now() - segmentStartedAt);
        setActiveElapsed({ storageKey, milliseconds: current });
        saveElapsed(storageKey, current);
      };
      const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden' && segmentStartedAt !== null) {
          elapsed += Date.now() - segmentStartedAt;
          segmentStartedAt = null;
          checkpoint();
        } else if (document.visibilityState === 'visible' && segmentStartedAt === null) {
          segmentStartedAt = Date.now();
          checkpoint();
        }
      };
      const interval = window.setInterval(checkpoint, 1000);
      document.addEventListener('visibilitychange', onVisibilityChange);
      checkpoint();
      return () => {
        if (segmentStartedAt !== null) elapsed += Date.now() - segmentStartedAt;
        segmentStartedAt = null;
        saveElapsed(storageKey, elapsed);
        window.clearInterval(interval);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      };
    }

    if (stoppedAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [startedAt, stoppedAt, storageKey]);

  if (!startedAt) return null;
  const activeElapsedMs = storageKey
    ? activeElapsed.storageKey === storageKey
      ? activeElapsed.milliseconds
      : (readElapsed(storageKey) ?? 0)
    : 0;
  const elapsedSeconds = Math.max(
    0,
    Math.floor(
      storageKey
        ? activeElapsedMs / 1000
        : ((stoppedAt ?? now) - startedAt) / 1000,
    ),
  );

  return (
    <span
      className="lesson-elapsed-timer"
      role="timer"
      aria-label={`Lesson time ${formatElapsed(elapsedSeconds)}`}
    >
      <Clock3 aria-hidden="true" size={15} />
      <span>Lesson time</span>
      <strong>{formatElapsed(elapsedSeconds)}</strong>
    </span>
  );
}
