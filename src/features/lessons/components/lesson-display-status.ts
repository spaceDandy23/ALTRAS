import type { LessonProgress } from '@/types/learning';

export type LessonDisplayStatus =
  'locked' | 'not-started' | 'in-progress' | 'needs-retry' | 'cleared';

export function resolveLessonDisplayStatus(
  progress: LessonProgress,
  hasActiveAttempt = false,
): LessonDisplayStatus {
  if (progress.status === 'locked') return 'locked';
  if (hasActiveAttempt || progress.status === 'in-progress') return 'in-progress';
  if (progress.status === 'cleared') return 'cleared';
  return progress.attemptCount > 0 ? 'needs-retry' : 'not-started';
}
