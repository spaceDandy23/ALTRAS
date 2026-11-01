import type { LearningLesson } from './content.schemas';
import type { LessonAttempt } from '@/types/learning';

export type LessonFlowStage = NonNullable<LessonAttempt['flowStage']>;

export function lessonChapters(lesson: LearningLesson) {
  if (lesson.chapters?.length)
    return [...lesson.chapters].sort((left, right) => left.displayOrder - right.displayOrder);
  return [
    {
      id: `chapter-${lesson.id}`,
      title: 'Chapter 1',
      description: lesson.shortDescription,
      displayOrder: 1,
      instructionalContent: lesson.instructionalContent,
      activities: lesson.activities,
    },
  ];
}

export function chapterActivityPosition(
  lesson: LearningLesson,
  chapterId: string,
  activityId: string,
) {
  const chapters = lessonChapters(lesson);
  const chapterIndex = chapters.findIndex((chapter) => chapter.id === chapterId);
  if (chapterIndex < 0) return null;
  const activityIndex = chapters[chapterIndex].activities.findIndex(
    (activity) => activity.id === activityId,
  );
  if (activityIndex < 0) return null;
  return {
    chapterIndex,
    activityIndex,
    flatActivityIndex:
      chapters
        .slice(0, chapterIndex)
        .reduce((total, chapter) => total + chapter.activities.length, 0) + activityIndex,
    isLastInChapter: activityIndex === chapters[chapterIndex].activities.length - 1,
  };
}

export function lessonFlowPosition(
  lesson: LearningLesson,
  stage: LessonFlowStage | undefined,
  chapterId: string | null | undefined,
) {
  if (!stage || stage === 'legacy-activity') return -1;
  if (stage === 'pre-test') return 0;
  const chapters = lessonChapters(lesson);
  if (stage === 'post-test') return chapters.length * 2 + 1;
  if (stage === 'ready-to-complete') return chapters.length * 2 + 2;
  const chapterIndex = chapters.findIndex((chapter) => chapter.id === chapterId);
  if (chapterIndex < 0) return -1;
  return chapterIndex * 2 + (stage === 'chapter-teaching' ? 1 : 2);
}

export function nextLessonFlowState(
  lesson: LearningLesson,
  attempt: LessonAttempt,
): { flowStage: LessonFlowStage; currentChapterId: string | null } | null {
  const stage = attempt.flowStage;
  const chapters = lessonChapters(lesson);
  const chapterIndex = chapters.findIndex((chapter) => chapter.id === attempt.currentChapterId);
  const currentChapter = chapters[chapterIndex];
  if (stage === 'pre-test') {
    return { flowStage: 'chapter-teaching', currentChapterId: chapters[0]?.id ?? null };
  }
  if (stage === 'chapter-teaching' && currentChapter?.activities.length) {
    return { flowStage: 'chapter-activity', currentChapterId: currentChapter.id };
  }
  if (stage === 'chapter-teaching' || stage === 'chapter-activity') {
    const nextChapter = chapters[chapterIndex + 1];
    if (nextChapter) return { flowStage: 'chapter-teaching', currentChapterId: nextChapter.id };
    return attempt.postAssessmentVersion
      ? { flowStage: 'post-test', currentChapterId: attempt.currentChapterId ?? null }
      : { flowStage: 'ready-to-complete', currentChapterId: attempt.currentChapterId ?? null };
  }
  if (stage === 'post-test') {
    return { flowStage: 'ready-to-complete', currentChapterId: attempt.currentChapterId ?? null };
  }
  return null;
}
