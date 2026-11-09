import { describe, expect, it } from 'vitest';
import type { LessonAttempt } from '@/types/learning';
import { packagedContent } from '../content/packaged-content';
import { activityResultForAttempt } from './activity-result';

const lesson = packagedContent.lessons[0];

function attempt(correctCount: number): LessonAttempt {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    userId: '20000000-0000-4000-8000-000000000002',
    lessonId: lesson.id,
    contentVersion: lesson.contentVersion,
    status: 'active',
    startedAt: 1,
    lastUpdatedAt: 1,
    completedAt: null,
    abandonedAt: null,
    answers: lesson.activities.map((activity, index) => ({
      activityId: activity.id,
      activityType: activity.type,
      answer: activity.type === 'organize-translate'
        ? activity.correctTokenSequence ?? []
        : activity.correctChoiceId,
      isCorrect: index < correctCount,
      submittedAt: index + 2,
    })),
    finalScore: null,
    starCount: null,
    cleared: null,
    xpImprovement: 0,
  };
}

describe('activity result score', () => {
  it('calculates zero, partial, and full correct-answer totals from confirmed answers', () => {
    expect(activityResultForAttempt(attempt(0), lesson)).toMatchObject({
      correct: 0,
      total: lesson.activities.length,
      percentage: 0,
    });
    expect(activityResultForAttempt(attempt(2), lesson)).toMatchObject({
      correct: 2,
      total: lesson.activities.length,
      percentage: Math.round((2 / lesson.activities.length) * 100),
    });
    expect(activityResultForAttempt(attempt(lesson.activities.length), lesson)).toMatchObject({
      correct: lesson.activities.length,
      total: lesson.activities.length,
      percentage: 100,
    });
  });

  it('does not expose a score until every lesson activity is confirmed', () => {
    const partial = attempt(1);
    partial.answers = partial.answers.slice(0, -1);
    expect(activityResultForAttempt(partial, lesson)).toBeNull();
  });
});
