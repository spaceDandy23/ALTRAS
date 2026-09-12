import type { LessonAttempt } from '@/types/learning';
import type { LessonHubEntry } from '@/features/lessons/progress/progress.service';

export function selectHomeLesson(entries: LessonHubEntry[], activeAttempt: LessonAttempt | null) {
  if (activeAttempt) {
    const activeEntry = entries.find(({ lesson }) => lesson.id === activeAttempt.lessonId);
    if (activeEntry) return activeEntry;
  }

  return (
    entries.find(({ progress }) => progress.status !== 'locked' && progress.status !== 'cleared') ??
    [...entries].reverse().find(({ progress }) => progress.status === 'cleared')
  );
}
