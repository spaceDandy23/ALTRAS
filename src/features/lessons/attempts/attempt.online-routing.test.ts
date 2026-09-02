import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AltrasDatabase } from '@/db/database';
import type { LessonAttempt } from '@/types/learning';

const mocks = vi.hoisted(() => ({
  getActive: vi.fn(),
  start: vi.fn(),
  restart: vi.fn(),
  submit: vi.fn(),
  complete: vi.fn(),
  get: vi.fn(),
  recordSeconds: vi.fn(),
  ensureProgress: vi.fn(),
}));

vi.mock('./online-attempt.service', () => ({
  completeOnlineAttempt: mocks.complete,
  getOnlineActiveAttempt: mocks.getActive,
  getOnlineAttempt: mocks.get,
  recordOnlineActiveSeconds: mocks.recordSeconds,
  restartOnlineAttempt: mocks.restart,
  startOrResumeOnlineAttempt: mocks.start,
  submitOnlineActivityAnswer: mocks.submit,
}));
vi.mock('../progress/progress.service', () => ({
  ensureUserLessonProgress: mocks.ensureProgress,
}));

import {
  completeAttempt,
  ensureLearningReady,
  getActiveAttempt,
  getAttempt,
  recordAttemptActiveSeconds,
  restartAttempt,
  startOrResumeAttempt,
  submitActivityAnswer,
} from './attempt.service';

const database = {} as AltrasDatabase;
const attempt: LessonAttempt = {
  id: '10000000-0000-4000-8000-000000000001',
  userId: '20000000-0000-4000-8000-000000000002',
  lessonId: 'lesson-operation-signals',
  contentVersion: 1,
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
};

describe('Supabase-only lesson attempt routing', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('routes attempt reads and lifecycle writes only to online services', async () => {
    mocks.getActive.mockResolvedValue(attempt);
    mocks.start.mockResolvedValue(attempt);
    mocks.restart.mockResolvedValue(attempt);
    mocks.complete.mockResolvedValue({ ...attempt, status: 'completed' });
    mocks.get.mockResolvedValue(attempt);

    await expect(getActiveAttempt(database, attempt.userId, attempt.lessonId)).resolves.toBe(
      attempt,
    );
    await expect(startOrResumeAttempt(database, attempt.userId, attempt.lessonId)).resolves.toBe(
      attempt,
    );
    await expect(restartAttempt(database, attempt.userId, attempt.lessonId)).resolves.toBe(attempt);
    await completeAttempt(database, attempt.id);
    await getAttempt(database, attempt.userId, attempt.id);
    await recordAttemptActiveSeconds(database, attempt.id, 12);
    await ensureLearningReady(database, attempt.userId);

    expect(mocks.getActive).toHaveBeenCalledWith(attempt.userId, attempt.lessonId);
    expect(mocks.start).toHaveBeenCalledWith(database, attempt.userId, attempt.lessonId);
    expect(mocks.restart).toHaveBeenCalledWith(database, attempt.userId, attempt.lessonId);
    expect(mocks.complete).toHaveBeenCalledWith(database, attempt.id);
    expect(mocks.get).toHaveBeenCalledWith(attempt.userId, attempt.id);
    expect(mocks.recordSeconds).toHaveBeenCalledWith(attempt.id, 12);
    expect(mocks.ensureProgress).toHaveBeenCalledWith(database, attempt.userId);
  });

  it('forwards the already-loaded attempt for a single-request answer save', async () => {
    const saved = {
      ...attempt,
      answers: [
        {
          activityId: 'activity-one',
          activityType: 'find-word' as const,
          answer: 'choice-one',
          isCorrect: true,
          submittedAt: 2,
        },
      ],
    };
    mocks.submit.mockResolvedValue(saved);

    await expect(
      submitActivityAnswer(database, attempt.id, 'activity-one', 'choice-one', attempt),
    ).resolves.toBe(saved);
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledWith(
      database,
      attempt.id,
      'activity-one',
      'choice-one',
      attempt,
    );
  });

  it('does not hide authoritative save failures', async () => {
    mocks.submit.mockRejectedValue(new Error('Unable to save this answer online.'));
    await expect(
      submitActivityAnswer(database, attempt.id, 'activity-one', 'choice-one', attempt),
    ).rejects.toThrow('Unable to save this answer online.');
  });
});
