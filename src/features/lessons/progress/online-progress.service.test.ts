import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AltrasDatabase } from '@/db/database';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import { ensureOnlineLessonProgress, toLessonProgress } from './online-progress.service';

const supabase = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/services/supabase.client', () => ({ getSupabaseClient: () => supabase }));

describe('online lesson progress mapping', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => useResearcherAccessStore.getState().clear());

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

  it('uses the authoritative rows returned by progress initialization', async () => {
    const userId = '6ec599dd-3494-4e5d-b917-342905bcb1fa';
    const lessonId = 'lesson-two';
    supabase.rpc.mockResolvedValue({
      data: [
        {
          user_id: userId,
          lesson_id: lessonId,
          status: 'cleared',
          best_score: 100,
          best_star_count: 3,
          attempt_count: 1,
          xp_awarded: 130,
          first_started_at: '2026-09-08T01:00:00.000Z',
          last_attempted_at: '2026-09-08T01:05:00.000Z',
          cleared_at: '2026-09-08T01:05:00.000Z',
        },
      ],
      error: null,
    });
    const database = {
      lessons: {
        orderBy: () => ({ toArray: async () => [{ id: lessonId }] }),
      },
    } as unknown as AltrasDatabase;

    await expect(ensureOnlineLessonProgress(database, userId)).resolves.toMatchObject([
      { lessonId, status: 'cleared', attemptCount: 1 },
    ]);
    expect(supabase.rpc).toHaveBeenCalledWith('initialize_lesson_progress');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('blocks researchers before creating participant progress records', async () => {
    useResearcherAccessStore.setState({
      status: 'authorized',
      userId: '6ec599dd-3494-4e5d-b917-342905bcb1fa',
    });

    await expect(
      ensureOnlineLessonProgress({} as AltrasDatabase, '6ec599dd-3494-4e5d-b917-342905bcb1fa'),
    ).rejects.toThrow('Researcher accounts cannot create participant learning records.');
  });
});
