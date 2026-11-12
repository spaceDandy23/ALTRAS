import type { LessonAttemptLimit } from './content.schemas';

export function getConfiguredLessonAttemptLimit(
  attemptLimit: LessonAttemptLimit | undefined,
): number | null {
  return attemptLimit?.mode === 'limited' ? attemptLimit.maxAttempts : null;
}

export function formatLessonAttemptAvailability(
  maximum: number,
  attemptsUsed?: number,
): string {
  const maximumLabel = `Maximum: ${maximum} ${maximum === 1 ? 'attempt' : 'attempts'}`;
  if (attemptsUsed === undefined) return maximumLabel;
  const remaining = Math.max(0, maximum - attemptsUsed);
  return `Attempts left: ${remaining} · ${maximumLabel}`;
}
