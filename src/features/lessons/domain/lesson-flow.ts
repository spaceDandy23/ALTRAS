import type { LearningLesson } from './content.schemas';
import type { LessonAttempt } from '@/types/learning';

export type LessonFlowStage = NonNullable<LessonAttempt['flowStage']>;

export function hasChapterTeachingContent(chapter: { instructionalContent: { type: string }[] }) {
  return chapter.instructionalContent.some((block) => block.type !== 'vocabulary-table');
}

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
  const nextChapterState = (from: number) => {
    let lastChapterId = attempt.currentChapterId ?? null;
    for (const chapter of chapters.slice(from)) {
      if (hasChapterTeachingContent(chapter))
        return { flowStage: 'chapter-teaching' as const, currentChapterId: chapter.id };
      if (chapter.activities.length)
        return { flowStage: 'chapter-activity' as const, currentChapterId: chapter.id };
      lastChapterId = chapter.id;
    }
    return attempt.postAssessmentVersion
      ? { flowStage: 'post-test' as const, currentChapterId: lastChapterId }
      : { flowStage: 'ready-to-complete' as const, currentChapterId: lastChapterId };
  };
  if (stage === 'pre-test') {
    return nextChapterState(0);
  }
  if (stage === 'chapter-teaching' && currentChapter?.activities.length) {
    return { flowStage: 'chapter-activity', currentChapterId: currentChapter.id };
  }
  if (stage === 'chapter-teaching' || stage === 'chapter-activity') {
    return nextChapterState(chapterIndex + 1);
  }
  if (stage === 'post-test') {
    return { flowStage: 'ready-to-complete', currentChapterId: attempt.currentChapterId ?? null };
  }
  return null;
}
