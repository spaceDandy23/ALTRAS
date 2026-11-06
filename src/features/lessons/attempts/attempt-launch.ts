import type { LessonAttempt } from '@/types/learning';

export type LessonAttemptLaunchMode = 'first' | 'retry' | 'resume';

export function classifyLessonAttemptLaunch(
  activeAttempt: LessonAttempt | null,
  completedAttemptCount: number,
): LessonAttemptLaunchMode {
  if (activeAttempt) return 'resume';
  return completedAttemptCount > 0 ? 'retry' : 'first';
}
