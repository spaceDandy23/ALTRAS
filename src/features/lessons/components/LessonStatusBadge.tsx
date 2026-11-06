import type { LessonProgress } from '@/types/learning';
import { resolveLessonDisplayStatus, type LessonDisplayStatus } from './lesson-display-status';

const labels: Record<LessonDisplayStatus, string> = {
  locked: 'Locked',
  'not-started': 'Not started',
  'in-progress': 'In progress',
  'needs-retry': 'Needs retry',
  cleared: 'Cleared',
};

export function LessonStatusBadge({
  progress,
  hasActiveAttempt = false,
}: {
  progress: LessonProgress;
  hasActiveAttempt?: boolean;
}) {
  const status = resolveLessonDisplayStatus(progress, hasActiveAttempt);
  return <span className={`lesson-status lesson-status--${status}`}>{labels[status]}</span>;
}
