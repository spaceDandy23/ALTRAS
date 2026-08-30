import { describe, expect, it } from 'vitest';
import { toLessonProgress } from './online-progress.service';

describe('online lesson progress mapping', () => {
  it('maps database columns and timestamps to the lesson domain model', () => {
    expect(
      toLessonProgress({
        user_id: '6ec599dd-3494-4e5d-b917-342905bcb1fa',
        lesson_id: 'lesson-one',
        status: 'cleared',
        best_score: 100,
        best_star_count: 3,
        attempt_count: 2,
        xp_awarded: 130,
        first_started_at: '2026-08-30T12:00:00.000Z',
        last_attempted_at: '2026-08-30T12:05:00.000Z',
        cleared_at: '2026-08-30T12:05:00.000Z',
      }),
    ).toMatchObject({
      id: '6ec599dd-3494-4e5d-b917-342905bcb1fa:lesson-one',
      lessonId: 'lesson-one',
      status: 'cleared',
      bestScore: 100,
      bestStarCount: 3,
      attemptCount: 2,
      xpAwarded: 130,
      firstStartedAt: Date.parse('2026-08-30T12:00:00.000Z'),
    });
  });
});
