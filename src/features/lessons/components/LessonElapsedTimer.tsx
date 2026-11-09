import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';

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
}: {
  startedAt: number | null | undefined;
  stoppedAt?: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt || stoppedAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [startedAt, stoppedAt]);

  if (!startedAt) return null;
  const elapsedSeconds = Math.max(0, Math.floor(((stoppedAt ?? now) - startedAt) / 1000));

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
