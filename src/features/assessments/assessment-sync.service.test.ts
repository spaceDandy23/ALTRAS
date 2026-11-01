import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import type { AssessmentAttempt, AssessmentQuestion } from '@/types/assessment';
import {
  createOfflineAssessmentDraft,
  markDraftPendingSubmission,
  saveAssessmentDraft,
  updateDraftAnswer,
} from './assessment-draft.service';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  read: vi.fn(),
  sync: vi.fn(),
  complete: vi.fn(),
}));

vi.mock('./assessment.service', () => ({
  startAssessment: mocks.start,
  getAssessmentAttempt: mocks.read,
  syncAssessmentDraft: mocks.sync,
  completeAssessment: mocks.complete,
}));

import { syncPendingAssessmentDrafts } from './assessment-sync.service';

const userId = '10000000-0000-4000-8000-000000000001';
const lessonId = 'lesson-operation-signals';
const lessonAttemptId = '40000000-0000-4000-8000-000000000004';
const questions: AssessmentQuestion[] = [
  {
    id: 'q1',
    assessment: 'pre-test',
    displayOrder: 1,
    prompt: 'Question',
    choices: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    contentVersion: 1,
    isPlaceholder: false,
  },
];

function localSubmission() {
  return markDraftPendingSubmission(
    updateDraftAnswer(
      createOfflineAssessmentDraft(userId, 'pre-test', lessonId, lessonAttemptId, questions),
      'q1',
      'a',
    ),
  );
}

describe('global assessment synchronization', () => {
  beforeEach(async () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    await db.assessmentDrafts.clear();
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('starts, submits, and completes an offline assessment once across duplicate replay', async () => {
    const local = localSubmission();
    await saveAssessmentDraft(local);
    let server: AssessmentAttempt = {
      id: local.attemptId,
      userId,
      assessment: 'pre-test',
      status: 'active',
      startedAt: 1,
      submittedAt: null,
      score: null,
      completionSeconds: null,
      contentVersion: 1,
      expectedQuestionCount: 1,
      answers: [],
      acceptedRevision: 0,
      acceptedMutationId: null,
      submittedRevision: null,
      lessonId,
      lessonAttemptId,
    };
    mocks.start.mockImplementation(async () => server);
    mocks.read.mockImplementation(async () => server);
    mocks.sync.mockImplementation(async (draft) => {
      server = {
        ...server,
        answers: draft.answers,
        acceptedRevision: draft.revision,
        acceptedMutationId: draft.mutationId,
      };
      return server;
    });
    mocks.complete.mockImplementation(async () => {
      server = { ...server, status: 'submitted', score: 100, submittedRevision: 1 };
      return server;
    });

    const results = await Promise.all([
      syncPendingAssessmentDrafts(userId),
      syncPendingAssessmentDrafts(userId),
    ]);

    expect(results.every((result) => result.pending === 0)).toBe(true);
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(await db.assessmentDrafts.count()).toBe(0);
  });

  it('recognizes a server-accepted snapshot after the first response is lost', async () => {
    const local = localSubmission();
    await saveAssessmentDraft(local);
    let server: AssessmentAttempt = {
      id: local.attemptId,
      userId,
      assessment: 'pre-test',
      status: 'active',
      startedAt: 1,
      submittedAt: null,
      score: null,
      completionSeconds: null,
      contentVersion: 1,
      expectedQuestionCount: 1,
      answers: [],
      acceptedRevision: 0,
      acceptedMutationId: null,
      submittedRevision: null,
      lessonId,
      lessonAttemptId,
    };
    mocks.start.mockResolvedValue(server);
    mocks.read.mockImplementation(async () => server);
    mocks.sync.mockImplementationOnce(async (draft) => {
      server = {
        ...server,
        answers: draft.answers,
        acceptedRevision: draft.revision,
        acceptedMutationId: draft.mutationId,
      };
      throw new Error('response lost');
    });
    mocks.complete.mockImplementation(async () => {
      server = { ...server, status: 'submitted', score: 100, submittedRevision: 1 };
      return server;
    });

    await expect(syncPendingAssessmentDrafts(userId)).resolves.toMatchObject({
      failed: 1,
      pending: 1,
    });
    await expect(syncPendingAssessmentDrafts(userId)).resolves.toMatchObject({
      failed: 0,
      pending: 0,
    });

    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.complete).toHaveBeenCalledOnce();
  });
});
