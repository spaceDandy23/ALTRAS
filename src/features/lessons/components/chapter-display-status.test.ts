import { describe, expect, it } from 'vitest';
import { packagedContent } from '../content/packaged-content';
import type { LessonAttempt, LessonProgress } from '@/types/learning';
import { lessonChapters } from '../domain/lesson-flow';
import { resolveChapterDisplayStatuses } from './chapter-display-status';

const baseLesson = packagedContent.lessons[0];
const baseChapter = lessonChapters(baseLesson)[0];
const lesson = {
  ...baseLesson,
  chapters: [
    { ...baseChapter, id: 'chapter-one', displayOrder: 1 },
    { ...baseChapter, id: 'chapter-two', title: 'Chapter 2', displayOrder: 2 },
  ],
};
const [first, second] = lessonChapters(lesson);
const progress = (status: LessonProgress['status']): LessonProgress => ({
  id: `student:${lesson.id}`,
  userId: '10000000-0000-4000-8000-000000000001',
  lessonId: lesson.id,
  status,
  bestScore: 0,
  bestStarCount: 0,
  attemptCount: 0,
  xpAwarded: 0,
  firstStartedAt: null,
  lastAttemptedAt: null,
  clearedAt: null,
});
const attempt = (flowStage: LessonAttempt['flowStage'], currentChapterId: string | null): LessonAttempt => ({
  id: '20000000-0000-4000-8000-000000000002',
  userId: '10000000-0000-4000-8000-000000000001',
  lessonId: lesson.id,
  contentVersion: lesson.contentVersion,
  status: 'active',
  startedAt: 1,
  lastUpdatedAt: 1,
  completedAt: null,
  abandonedAt: null,
  answers: [],
  finalScore: null,
  starCount: null,
  cleared: null,
  xpImprovement: 0,
  flowStage,
  currentChapterId,
  preAssessmentVersion: null,
  postAssessmentVersion: null,
});

describe('chapter display status', () => {
  it('uses the persisted lesson flow to mark completed, current, and untouched chapters', () => {
    expect(resolveChapterDisplayStatuses(lesson, progress('in-progress'), attempt('chapter-activity', second.id)))
      .toEqual(lessonChapters(lesson).map((_, index) => index === 0 ? 'completed' : index === 1 ? 'in-progress' : 'not-started'));
  });

  it('marks chapters complete only after the lesson has reached the post-test or an official completion', () => {
    expect(resolveChapterDisplayStatuses(lesson, progress('in-progress'), attempt('post-test', first.id)))
      .toEqual(lessonChapters(lesson).map(() => 'completed'));
    expect(resolveChapterDisplayStatuses(lesson, progress('cleared'), undefined))
      .toEqual(lessonChapters(lesson).map(() => 'completed'));
  });

  it('keeps a locked lesson’s chapters locked without adding chapter unlock rules', () => {
    expect(resolveChapterDisplayStatuses(lesson, progress('locked'), undefined))
      .toEqual(lessonChapters(lesson).map(() => 'locked'));
  });
});
