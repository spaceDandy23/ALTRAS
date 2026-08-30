import { describe, expect, it } from 'vitest';
import { toAssessmentAttempt } from './assessment.service';

describe('online assessment attempt mapping', () => {
  it('maps a submitted result and its saved answers', () => {
    const attempt = toAssessmentAttempt({
      id: '3dd244a8-011c-4684-b759-e43ff1daec24',
      user_id: '6ec599dd-3494-4e5d-b917-342905bcb1fa',
      assessment: 'pre-test',
      status: 'submitted',
      started_at: '2026-08-30T12:00:00.000Z',
      submitted_at: '2026-08-30T12:03:00.000Z',
      score: 67,
      completion_seconds: 180,
      content_version: 1,
      expected_question_count: 3,
      assessment_attempt_answers: [
        {
          question_id: 'pre-placeholder-1',
          selected_choice_id: 'a',
          answered_at: '2026-08-30T12:01:00.000Z',
        },
      ],
    });

    expect(attempt).toMatchObject({
      assessment: 'pre-test',
      status: 'submitted',
      score: 67,
      completionSeconds: 180,
      expectedQuestionCount: 3,
    });
    expect(attempt.answers[0]).toMatchObject({
      questionId: 'pre-placeholder-1',
      selectedChoiceId: 'a',
    });
  });
});
