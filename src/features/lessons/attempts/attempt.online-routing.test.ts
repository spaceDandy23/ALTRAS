import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import type { LessonAttempt } from '@/types/learning';
import { packagedContent } from '../content/packaged-content';
import {
  createLessonDraft,
  getLessonDraft,
  queueLessonAnswer,
  queueLessonStageTransition,
  saveLessonDraft,
} from './lesson-draft.service';

const mocks = vi.hoisted(() => ({
  getActive: vi.fn(),
  prepare: vi.fn(),
  restart: vi.fn(),
  submit: vi.fn(),
  complete: vi.fn(),
  advance: vi.fn(),
  get: vi.fn(),
  recordSeconds: vi.fn(),
  ensureProgress: vi.fn(),
  getLesson: vi.fn(),
  getAssessmentQuestions: vi.fn(),
}));

vi.mock('./online-attempt.service', () => ({
  completeOnlineAttempt: mocks.complete,
  advanceOnlineAttemptStage: mocks.advance,
  getOnlineActiveAttempt: mocks.getActive,
  getOnlineAttempt: mocks.get,
  prepareOnlineAttempt: mocks.prepare,
  recordOnlineActiveSeconds: mocks.recordSeconds,
  restartOnlineAttempt: mocks.restart,
  submitOnlineActivityAnswer: mocks.submit,
}));
vi.mock('../progress/progress.service', () => ({
  ensureUserLessonProgress: mocks.ensureProgress,
}));
vi.mock('../content/content.service', () => ({ getLesson: mocks.getLesson }));
vi.mock('@/features/assessments/assessment.service', () => ({
  getAssessmentQuestions: mocks.getAssessmentQuestions,
}));

import {
  completeAttempt,
  advanceAttemptStage,
  consumeLessonAttemptLaunchMode,
  ensureLearningReady,
  flushPendingLessonAttempt,
  getActiveAttempt,
  getAttempt,
  recordAttemptActiveSeconds,
  restartAttempt,
  startOrResumeAttempt,
  submitActivityAnswer,
  syncPendingLessonDrafts,
} from './attempt.service';

const database = db;
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
  beforeEach(async () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: attempt.userId,
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getLesson.mockResolvedValue(packagedContent.lessons[0]);
    mocks.getAssessmentQuestions.mockImplementation(async (kind: 'pre-test' | 'post-test') => [
      {
        id: `${kind}-q1`,
        assessment: kind,
        displayOrder: 1,
        prompt: 'Question',
        choices: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        contentVersion: kind === 'pre-test' ? 3 : 4,
        isPlaceholder: false,
      },
    ]);
    await db.lessonDrafts.clear();
  });

  it('pins both safe assessment snapshots when a chapter lesson starts', async () => {
    const chapterAttempt = {
      ...attempt,
      preAssessmentVersion: 3,
      postAssessmentVersion: 4,
    };
    mocks.prepare.mockResolvedValue({ attempt: chapterAttempt, mode: 'first' });

    await startOrResumeAttempt(db, chapterAttempt.userId, chapterAttempt.lessonId);

    await expect(
      getLessonDraft(chapterAttempt.userId, chapterAttempt.lessonId, chapterAttempt.id),
    ).resolves.toMatchObject({
      assessmentQuestions: {
        'pre-test': [expect.objectContaining({ id: 'pre-test-q1' })],
        'post-test': [expect.objectContaining({ id: 'post-test-q1' })],
      },
    });
  });

  it('routes attempt reads and lifecycle writes only to online services', async () => {
    mocks.getActive.mockResolvedValue(attempt);
    mocks.prepare.mockResolvedValue({ attempt, mode: 'resume' });
    mocks.restart.mockResolvedValue(attempt);
    mocks.complete.mockResolvedValue({ ...attempt, status: 'completed' });
    mocks.advance.mockResolvedValue({ ...attempt, flowStage: 'chapter-activity' });
    mocks.get.mockResolvedValue(attempt);

    await expect(getActiveAttempt(database, attempt.userId, attempt.lessonId)).resolves.toBe(
      attempt,
    );
    await expect(startOrResumeAttempt(database, attempt.userId, attempt.lessonId)).resolves.toBe(
      attempt,
    );
    await expect(restartAttempt(database, attempt.userId, attempt.lessonId)).resolves.toBe(attempt);
    await completeAttempt(database, attempt.id);
    await advanceAttemptStage(attempt.id, 'chapter-teaching', 'chapter-one');
    await getAttempt(database, attempt.userId, attempt.id);
    const segmentId = '30000000-0000-4000-8000-000000000003';
    await recordAttemptActiveSeconds(database, attempt.id, 12, segmentId);
    await ensureLearningReady(database, attempt.userId);

    expect(mocks.getActive).toHaveBeenCalledWith(attempt.userId, attempt.lessonId);
    expect(mocks.prepare).toHaveBeenCalledWith(database, attempt.userId, attempt.lessonId);
    expect(mocks.restart).toHaveBeenCalledWith(database, attempt.userId, attempt.lessonId);
    expect(mocks.complete).toHaveBeenCalledWith(database, attempt.id, expect.any(Function));
    expect(mocks.advance).toHaveBeenCalledWith(
      attempt.id,
      'chapter-teaching',
      'chapter-one',
      expect.any(Function),
    );
    expect(mocks.get).toHaveBeenCalledWith(attempt.userId, attempt.id);
    expect(mocks.recordSeconds).toHaveBeenCalledWith(attempt.id, 12, segmentId);
    expect(mocks.ensureProgress).toHaveBeenCalledWith(database, attempt.userId);
  });

  it.each([
    ['first', 'first'],
    ['retry', 'retry'],
    ['resume', 'resume'],
  ] as const)(
    'preserves the actual %s launch mode for the player bootstrap',
    async (_case, mode) => {
      mocks.prepare.mockResolvedValue({ attempt, mode });

      await startOrResumeAttempt(database, attempt.userId, attempt.lessonId);

      expect(consumeLessonAttemptLaunchMode(attempt.id)).toBe(mode);
      expect(consumeLessonAttemptLaunchMode(attempt.id)).toBe('resume');
    },
  );

  it('marks an explicit restart as a new attempt instead of a restore', async () => {
    mocks.restart.mockResolvedValue(attempt);

    await restartAttempt(database, attempt.userId, attempt.lessonId);

    expect(consumeLessonAttemptLaunchMode(attempt.id)).toBe('retry');
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
      expect.any(Function),
    );
  });

  it('does not hide authoritative save failures', async () => {
    mocks.submit.mockRejectedValue(new Error('Unable to save this answer online.'));
    await expect(
      submitActivityAnswer(database, attempt.id, 'activity-one', 'choice-one', attempt),
    ).rejects.toThrow('Unable to save this answer online.');
  });

  it('flushes a durable pending stage before a scoped assessment starts', async () => {
    const lesson = {
      ...structuredClone(packagedContent.lessons[0]),
      chapters: [
        {
          id: 'chapter-one',
          title: 'Chapter one',
          displayOrder: 1,
          instructionalContent: packagedContent.lessons[0].instructionalContent,
          activities: packagedContent.lessons[0].activities,
        },
      ],
    };
    const teaching = {
      ...attempt,
      flowStage: 'chapter-teaching' as const,
      currentChapterId: 'chapter-one',
    };
    const draft = createLessonDraft(teaching, lesson);
    await saveLessonDraft(draft);
    await queueLessonStageTransition(draft.id);
    mocks.advance.mockResolvedValue({ ...teaching, flowStage: 'chapter-activity' });

    await flushPendingLessonAttempt(attempt.userId, attempt.lessonId, attempt.id);

    expect(mocks.advance).toHaveBeenCalledWith(
      attempt.id,
      'chapter-teaching',
      'chapter-one',
      expect.any(Function),
    );
    await expect(
      getLessonDraft(attempt.userId, attempt.lessonId, attempt.id),
    ).resolves.toMatchObject({ pendingStageTransitions: [] });
  });

  it('replays pending lesson work for the authenticated user without reopening the lesson', async () => {
    const lesson = structuredClone(packagedContent.lessons[0]);
    const pending = queueLessonAnswer(
      createLessonDraft(attempt, lesson),
      lesson.activities[0].id,
      lesson.activities[0].type,
      lesson.activities[0].type === 'find-word'
        ? lesson.activities[0].choices[0].id
        : lesson.activities[0].tokens.map((token) => token.id),
      1,
    );
    await saveLessonDraft(pending);
    mocks.submit.mockResolvedValue({
      ...attempt,
      answers: [
        {
          activityId: lesson.activities[0].id,
          activityType: lesson.activities[0].type,
          answer: pending.pendingAnswers[0].answer,
          isCorrect: true,
          submittedAt: 2,
        },
      ],
    });

    await expect(syncPendingLessonDrafts(attempt.userId)).resolves.toEqual({
      attempts: 1,
      failed: 0,
      pending: 0,
      invalid: 0,
    });

    expect(mocks.submit).toHaveBeenCalledOnce();
    await expect(
      getLessonDraft(attempt.userId, attempt.lessonId, attempt.id),
    ).resolves.toMatchObject({ pendingAnswers: [] });
  });

  it('keeps pending attempts isolated and leaves the mounted active attempt to its page worker', async () => {
    const lesson = structuredClone(packagedContent.lessons[0]);
    const secondAttempt = { ...attempt, id: '10000000-0000-4000-8000-000000000009' };
    const answer =
      lesson.activities[0].type === 'find-word'
        ? lesson.activities[0].choices[0].id
        : lesson.activities[0].tokens.map((token) => token.id);
    await saveLessonDraft(
      queueLessonAnswer(
        createLessonDraft(attempt, lesson),
        lesson.activities[0].id,
        lesson.activities[0].type,
        answer,
        1,
      ),
    );
    await saveLessonDraft(
      queueLessonAnswer(
        createLessonDraft(secondAttempt, lesson),
        lesson.activities[0].id,
        lesson.activities[0].type,
        answer,
        1,
      ),
    );
    mocks.submit.mockImplementation(async (_database, attemptId) => ({
      ...(attemptId === attempt.id ? attempt : secondAttempt),
      answers: [
        {
          activityId: lesson.activities[0].id,
          activityType: lesson.activities[0].type,
          answer,
          isCorrect: true,
          submittedAt: 2,
        },
      ],
    }));

    await expect(syncPendingLessonDrafts(attempt.userId, new Set([attempt.id]))).resolves.toEqual({
      attempts: 1,
      failed: 0,
      pending: 0,
      invalid: 0,
    });

    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.submit.mock.calls[0][1]).toBe(secondAttempt.id);
    await expect(
      getLessonDraft(attempt.userId, attempt.lessonId, attempt.id),
    ).resolves.toMatchObject({
      pendingAnswers: [expect.objectContaining({ activityId: lesson.activities[0].id })],
    });
    await expect(
      getLessonDraft(secondAttempt.userId, secondAttempt.lessonId, secondAttempt.id),
    ).resolves.toMatchObject({ pendingAnswers: [] });
  });

  it('coalesces overlapping global replay requests for the same attempt', async () => {
    const lesson = structuredClone(packagedContent.lessons[0]);
    const answer =
      lesson.activities[0].type === 'find-word'
        ? lesson.activities[0].choices[0].id
        : lesson.activities[0].tokens.map((token) => token.id);
    await saveLessonDraft(
      queueLessonAnswer(
        createLessonDraft(attempt, lesson),
        lesson.activities[0].id,
        lesson.activities[0].type,
        answer,
        1,
      ),
    );
    let finish!: (value: LessonAttempt) => void;
    mocks.submit.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    const first = syncPendingLessonDrafts(attempt.userId);
    const second = syncPendingLessonDrafts(attempt.userId);
    await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    finish({
      ...attempt,
      answers: [
        {
          activityId: lesson.activities[0].id,
          activityType: lesson.activities[0].type,
          answer,
          isCorrect: true,
          submittedAt: 2,
        },
      ],
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { attempts: 1, failed: 0, pending: 0, invalid: 0 },
      { attempts: 1, failed: 0, pending: 0, invalid: 0 },
    ]);
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
});
