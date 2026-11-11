import { afterEach, describe, expect, it, vi } from 'vitest';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import {
  recordOnlineActiveSeconds,
  submitOnlineActivityAnswer,
  toLessonAttempt,
} from './online-attempt.service';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getLesson: vi.fn() }));
vi.mock('@/services/supabase.client', () => ({
  getSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('../content/content.service', () => ({ getLesson: mocks.getLesson }));

describe('online lesson attempt mapping', () => {
  afterEach(() => {
    useResearcherAccessStore.getState().clear();
    vi.clearAllMocks();
  });

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

  it('blocks researchers before writing participant attempt activity', async () => {
    useResearcherAccessStore.setState({ status: 'authorized', userId: crypto.randomUUID() });

    await expect(
      recordOnlineActiveSeconds(crypto.randomUUID(), 10, crypto.randomUUID()),
    ).rejects.toThrow('Researcher accounts cannot create participant learning records.');
  });

  it('submits an answer without an avoidable lesson-content fetch', async () => {
    const attempt = toLessonAttempt({
      id: '3dd244a8-011c-4684-b759-e43ff1daec24',
      user_id: '6ec599dd-3494-4e5d-b917-342905bcb1fa',
      lesson_id: 'lesson-one',
      content_version: 2,
      status: 'active',
      started_at: '2026-08-30T12:00:00.000Z',
      last_updated_at: '2026-08-30T12:00:00.000Z',
      completed_at: null,
      abandoned_at: null,
      final_score: null,
      star_count: null,
      cleared: null,
      xp_improvement: 0,
      attempt_answers: [],
    });
    mocks.rpc.mockResolvedValue({
      data: {
        activity_id: 'activity-one',
        activity_type: 'find-word',
        submitted_answer: 'choice-one',
        is_correct: true,
        submitted_at: '2026-08-30T12:01:00.000Z',
      },
      error: null,
    });

    const updated = await submitOnlineActivityAnswer(
      {} as never,
      attempt.id,
      'activity-one',
      'choice-one',
      attempt,
    );

    expect(updated.answers).toHaveLength(1);
    expect(mocks.getLesson).not.toHaveBeenCalled();
  });
});
