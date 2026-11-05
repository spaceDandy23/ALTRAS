import type { LearningLesson } from '../domain/content.schemas';
import { lessonChapters } from '../domain/lesson-flow';
import type { LessonAttempt, LessonProgress } from '@/types/learning';

export type ChapterDisplayStatus = 'completed' | 'in-progress' | 'not-started' | 'locked';

export function resolveChapterDisplayStatuses(
  lesson: LearningLesson,
  progress: LessonProgress | null,
  attempt: LessonAttempt | undefined,
): ChapterDisplayStatus[] {
  const chapters = lessonChapters(lesson);
  if (progress?.status === 'locked') return chapters.map(() => 'locked');
  if (progress?.status === 'cleared' || attempt?.status === 'completed') {
    return chapters.map(() => 'completed');
  }
  const stage = attempt?.flowStage;
  if (!stage || stage === 'legacy-activity' || stage === 'pre-test') {
    return chapters.map(() => 'not-started');
  }
  if (stage === 'post-test' || stage === 'ready-to-complete') {
    return chapters.map(() => 'completed');
  }
  const currentIndex = chapters.findIndex((chapter) => chapter.id === attempt?.currentChapterId);
  if (currentIndex < 0) return chapters.map(() => 'not-started');
  return chapters.map((_, index) =>
    index < currentIndex ? 'completed' : index === currentIndex ? 'in-progress' : 'not-started',
  );
}
