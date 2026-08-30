import { describe, expect, it } from 'vitest';
import { toLessonAttempt } from './online-attempt.service';

describe('online lesson attempt mapping', () => {
  it('maps database attempts and answers into the lesson domain model', () => {
    const attempt = toLessonAttempt({
      id: '3dd244a8-011c-4684-b759-e43ff1daec24',
      user_id: '6ec599dd-3494-4e5d-b917-342905bcb1fa',
      lesson_id: 'lesson-one',
      content_version: 2,
      status: 'completed',
      started_at: '2026-08-30T12:00:00.000Z',
      last_updated_at: '2026-08-30T12:05:00.000Z',
      completed_at: '2026-08-30T12:05:00.000Z',
      abandoned_at: null,
      final_score: 100,
      star_count: 3,
      cleared: true,
      xp_improvement: 130,
      attempt_answers: [
        {
          activity_id: 'activity-one',
          activity_type: 'find-word',
          submitted_answer: 'choice-one',
          is_correct: true,
          submitted_at: '2026-08-30T12:01:00.000Z',
        },
      ],
    });

    expect(attempt).toMatchObject({
      lessonId: 'lesson-one',
      contentVersion: 2,
      status: 'completed',
      finalScore: 100,
      starCount: 3,
      cleared: true,
      xpImprovement: 130,
    });
    expect(attempt.answers[0]).toMatchObject({
      activityId: 'activity-one',
      answer: 'choice-one',
      isCorrect: true,
    });
  });
});
