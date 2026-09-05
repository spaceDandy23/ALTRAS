import { afterEach, describe, expect, it, vi } from 'vitest';
import { AltrasDatabase } from '@/db/database';
import type { AssessmentAttempt, AssessmentDraft, AssessmentQuestion } from '@/types/assessment';
import {
  ASSESSMENT_SYNC_RETRY_DELAYS,
  AssessmentDraftSynchronizer,
  createAssessmentDraft,
  getAssessmentDraft,
  reconcileAssessmentDraft,
  saveAssessmentDraft,
  updateDraftAnswer,
} from './assessment-draft.service';

const questions: AssessmentQuestion[] = [{
  id: 'question-1', assessment: 'pre-test', displayOrder: 1, prompt: 'Prompt',
  choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  contentVersion: 1, isPlaceholder: false,
}];

function attempt(userId: string, attemptId: string, answeredAt = 0): AssessmentAttempt {
  return {
    id: attemptId, userId, assessment: 'pre-test', status: 'active', startedAt: 1,
    submittedAt: null, score: null, completionSeconds: null, contentVersion: 1,
    expectedQuestionCount: 1,
    answers: answeredAt ? [{ questionId: 'question-1', selectedChoiceId: 'a', answeredAt }] : [],
  };
}

const userA = '10000000-0000-4000-8000-000000000001';
const userB = '20000000-0000-4000-8000-000000000002';
const attemptA = '30000000-0000-4000-8000-000000000003';
const attemptB = '40000000-0000-4000-8000-000000000004';

afterEach(() => vi.useRealTimers());

describe('assessment local drafts', () => {
  it('isolates drafts by authenticated user and assessment attempt', async () => {
    const database = new AltrasDatabase(`assessment-drafts-${crypto.randomUUID()}`);
    const draftA = updateDraftAnswer(createAssessmentDraft(attempt(userA, attemptA), questions), 'question-1', 'a', 10);
    const draftB = updateDraftAnswer(createAssessmentDraft(attempt(userB, attemptB), questions), 'question-1', 'b', 20);
    await saveAssessmentDraft(draftA, database);
    await saveAssessmentDraft(draftB, database);

    await expect(getAssessmentDraft(userA, 'pre-test', database)).resolves.toMatchObject({ userId: userA, attemptId: attemptA, answers: [{ selectedChoiceId: 'a' }] });
    await expect(getAssessmentDraft(userB, 'pre-test', database)).resolves.toMatchObject({ userId: userB, attemptId: attemptB, answers: [{ selectedChoiceId: 'b' }] });
    await database.delete();
  });

  it('keeps a newer unsynced local revision but accepts a newer server draft', () => {
    const server = attempt(userA, attemptA, 100);
    const local = updateDraftAnswer(createAssessmentDraft(attempt(userA, attemptA), questions), 'question-1', 'b', 200);
    expect(reconcileAssessmentDraft(server, local, questions).answers[0].selectedChoiceId).toBe('b');

    const newerServer = attempt(userA, attemptA, 300);
    expect(reconcileAssessmentDraft(newerServer, local, questions).answers[0].selectedChoiceId).toBe('a');
  });

  it('bounds automatic retries and accepts a later meaningful retry trigger', async () => {
    vi.useFakeTimers();
    const draft = updateDraftAnswer(createAssessmentDraft(attempt(userA, attemptA), questions), 'question-1', 'a', 10);
    const sync = vi.fn().mockRejectedValue(new Error('offline'));
    const synchronizer = new AssessmentDraftSynchronizer({ load: vi.fn().mockResolvedValue(draft), sync, markSynced: vi.fn() });

    synchronizer.requestSync();
    await vi.advanceTimersByTimeAsync(0);
    for (const delay of ASSESSMENT_SYNC_RETRY_DELAYS) await vi.advanceTimersByTimeAsync(delay);
    expect(sync).toHaveBeenCalledTimes(1 + ASSESSMENT_SYNC_RETRY_DELAYS.length);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).toHaveBeenCalledTimes(6);

    synchronizer.requestSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(7);
    synchronizer.dispose();
  });

  it('coalesces changes and syncs the newest revision after an older request finishes', async () => {
    let current: AssessmentDraft = updateDraftAnswer(createAssessmentDraft(attempt(userA, attemptA), questions), 'question-1', 'a', 10);
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const sync = vi.fn().mockImplementationOnce(() => first).mockResolvedValue(undefined);
    const synchronizer = new AssessmentDraftSynchronizer({ load: async () => current, sync, markSynced: vi.fn() });
    synchronizer.requestSync();
    await Promise.resolve();
    current = updateDraftAnswer(current, 'question-1', 'b', 20);
    release();
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(2));
    expect(sync.mock.calls[0][0].revision).toBe(1);
    expect(sync.mock.calls[1][0].revision).toBe(2);
    synchronizer.dispose();
  });
});
