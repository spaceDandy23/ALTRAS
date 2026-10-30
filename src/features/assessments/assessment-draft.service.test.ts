import { afterEach, describe, expect, it, vi } from 'vitest';
import { AltrasDatabase } from '@/db/database';
import type { AssessmentAttempt, AssessmentDraft, AssessmentQuestion } from '@/types/assessment';
import {
  ASSESSMENT_SYNC_RETRY_DELAYS,
  AssessmentDraftSynchronizer,
  createAssessmentDraft,
  deleteAssessmentDraft,
  getAssessmentDraft,
  markDraftPendingSubmission,
  reconcileAssessmentDraft,
  saveAssessmentDraft,
  updateDraftAnswer,
  validateLocalDraft,
} from './assessment-draft.service';

const questions: AssessmentQuestion[] = [
  {
    id: 'q',
    assessment: 'pre-test',
    displayOrder: 1,
    prompt: 'Prompt',
    choices: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    contentVersion: 1,
    isPlaceholder: false,
  },
];
const userId = '10000000-0000-4000-8000-000000000001';
const attemptId = '30000000-0000-4000-8000-000000000003';
const attempt = (): AssessmentAttempt => ({
  id: attemptId,
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
});
const draft = () => updateDraftAnswer(createAssessmentDraft(attempt(), questions), 'q', 'a');
function harness(initial = draft()) {
  let current: AssessmentDraft | null = initial;
  let server = attempt();
  const read = vi.fn(async () => server);
  const sync = vi.fn(async (snapshot: AssessmentDraft) => {
    server = {
      ...server,
      answers: snapshot.answers,
      acceptedRevision: snapshot.revision,
      acceptedMutationId: snapshot.mutationId,
    };
    return server;
  });
  const complete = vi.fn(async (snapshot: AssessmentDraft) => {
    server = {
      ...server,
      status: 'submitted',
      submittedRevision: snapshot.revision,
      score: 100,
      submittedAt: 2,
    };
    return server;
  });
  const acknowledge = vi.fn(async (snapshot: AssessmentDraft) => {
    if (current)
      current = {
        ...current,
        pendingSnapshot: undefined,
        syncedRevision: snapshot.revision,
        syncStatus:
          current.syncStatus === 'pending_submission'
            ? 'pending_submission'
            : current.revision === snapshot.revision
              ? 'synced'
              : 'pending',
      };
  });
  const onCompleted = vi.fn(async () => {
    current = null;
  });
  const onStatus = vi.fn();
  const coordinator = new AssessmentDraftSynchronizer({
    load: async () => current,
    read,
    sync,
    complete,
    acknowledge,
    onCompleted,
    onStatus,
    beforeSync: async (snapshot) => {
      if (current && snapshot.mutationId)
        current = {
          ...current,
          pendingSnapshot: { revision: snapshot.revision, mutationId: snapshot.mutationId },
        };
    },
  });
  return {
    coordinator,
    read,
    sync,
    complete,
    acknowledge,
    onCompleted,
    onStatus,
    get current() {
      return current!;
    },
    set current(value: AssessmentDraft) {
      current = value;
    },
    get server() {
      return server;
    },
    set server(value: AssessmentAttempt) {
      server = value;
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('logical assessment drafts', () => {
  it('ignores clock skew and late server timestamps when restoring unsynced answers', () => {
    const local = updateDraftAnswer(createAssessmentDraft(attempt(), questions), 'q', 'b', 1);
    const remote = {
      ...attempt(),
      answers: [{ questionId: 'q', selectedChoiceId: 'a', answeredAt: 9999999999999 }],
    };
    expect(reconcileAssessmentDraft(remote, local, questions).answers[0].selectedChoiceId).toBe(
      'b',
    );
    expect(updateDraftAnswer(local, 'q', 'a', 0).revision).toBe(2);
  });
  it('uses server acknowledged revisions on cross-device resume and exact retry reconciliation', () => {
    const local = draft();
    const remote = {
      ...attempt(),
      answers: local.answers,
      acceptedRevision: local.revision,
      acceptedMutationId: local.mutationId,
    };
    expect(createAssessmentDraft(remote, questions).revision).toBe(1);
    expect(reconcileAssessmentDraft(remote, local, questions).syncStatus).toBe('synced');
  });
  it('isolates accounts and rejects stale local writes and unsafe deletion', async () => {
    const database = new AltrasDatabase(`draft-${crypto.randomUUID()}`);
    try {
      const older = draft();
      const newer = updateDraftAnswer(older, 'q', 'b');
      await saveAssessmentDraft(newer, database);
      await expect(saveAssessmentDraft(older, database)).rejects.toThrow('Another tab');
      await expect(
        saveAssessmentDraft({ ...newer, mutationId: crypto.randomUUID() }, database),
      ).rejects.toThrow('Another tab');
      expect(await getAssessmentDraft(crypto.randomUUID(), 'pre-test', database)).toBeNull();
      expect(
        await deleteAssessmentDraft(older.id, older.revision, older.mutationId, database),
      ).toBe(false);
      expect(
        (await getAssessmentDraft(userId, 'pre-test', database))?.answers[0].selectedChoiceId,
      ).toBe('b');
      expect(
        await deleteAssessmentDraft(newer.id, newer.revision, newer.mutationId, database),
      ).toBe(true);
    } finally {
      await database.delete();
    }
  });
  it('propagates Dexie persistence errors', async () => {
    const database = new AltrasDatabase(`draft-${crypto.randomUUID()}`);
    vi.spyOn(database.assessmentDrafts, 'put').mockRejectedValue(new Error('quota'));
    await expect(saveAssessmentDraft(draft(), database)).rejects.toThrow('quota');
    await database.delete();
  });
  it('rejects invalid content/identity and clamps a restored index', () => {
    expect(() => createAssessmentDraft(attempt(), [])).toThrow('incomplete');
    expect(() =>
      createAssessmentDraft(attempt(), [{ ...questions[0], contentVersion: 2 }]),
    ).toThrow('content');
    expect(() => validateLocalDraft(draft(), crypto.randomUUID(), 'pre-test')).toThrow('session');
    expect(() => validateLocalDraft({ ...draft(), revision: -1 }, userId, 'pre-test')).toThrow(
      'invalid',
    );
    expect(
      reconcileAssessmentDraft(attempt(), { ...draft(), currentQuestionIndex: -20 }, questions)
        .currentQuestionIndex,
    ).toBe(0);
  });
});

describe('serialized assessment coordinator', () => {
  it('coalesces autosync, focus/reconnect, Submit and repeat Submit without concurrent writes', async () => {
    const h = harness();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realSync = h.sync.getMockImplementation()!;
    h.sync.mockImplementationOnce(async (snapshot) => {
      await blocked;
      return realSync(snapshot);
    });
    h.coordinator.requestSync();
    await vi.waitFor(() => expect(h.sync).toHaveBeenCalledTimes(1));
    h.current = markDraftPendingSubmission(updateDraftAnswer(h.current, 'q', 'b'));
    h.coordinator.requestSync();
    h.coordinator.requestSync();
    const first = h.coordinator.flush();
    const second = h.coordinator.flush();
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.sync).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(h.sync).toHaveBeenCalledTimes(2);
    expect(h.sync.mock.calls[1][0]).toMatchObject({
      revision: 2,
      syncedRevision: 1,
      answers: [{ selectedChoiceId: 'b' }],
    });
    expect(h.complete).toHaveBeenCalledTimes(1);
    expect(h.complete.mock.calls[0][0].revision).toBe(2);
    h.coordinator.dispose();
  });
  it('recovers a lost completion response immediately by reading status, without answer replay', async () => {
    const h = harness(markDraftPendingSubmission(draft()));
    const finish = h.complete.getMockImplementation()!;
    h.complete.mockImplementationOnce(async (snapshot) => {
      await finish(snapshot);
      throw new Error('response lost');
    });
    await h.coordinator.flush();
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.sync).toHaveBeenCalledTimes(1);
    expect(h.onCompleted).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'submitted', submittedRevision: 1 }),
    );
    h.coordinator.dispose();
  });
  it('checks completion before writes on later recovery after both completion and status timeout', async () => {
    const h = harness(markDraftPendingSubmission(draft()));
    const finish = h.complete.getMockImplementation()!;
    h.complete.mockImplementationOnce(async (snapshot) => {
      await finish(snapshot);
      h.read.mockRejectedValueOnce(new Error('offline'));
      throw new Error('timeout');
    });
    await h.coordinator.flush();
    expect(h.onCompleted).not.toHaveBeenCalled();
    await h.coordinator.flush();
    expect(h.sync).toHaveBeenCalledTimes(1);
    expect(h.complete).toHaveBeenCalledTimes(1);
    expect(h.onCompleted).toHaveBeenCalledTimes(1);
    h.coordinator.dispose();
  });
  it('recognizes a late accepted snapshot after timeout without resending it', async () => {
    const h = harness();
    const accept = h.sync.getMockImplementation()!;
    h.sync.mockImplementationOnce(async (snapshot) => {
      await accept(snapshot);
      throw new Error('timeout');
    });
    await h.coordinator.flush();
    await h.coordinator.flush();
    expect(h.sync).toHaveBeenCalledTimes(1);
    expect(h.current.syncStatus).toBe('synced');
    h.coordinator.dispose();
  });
  it('refuses stale-tab conflicts even if the tab has a higher local counter', async () => {
    const h = harness({ ...draft(), revision: 50 });
    h.server = { ...attempt(), acceptedRevision: 2, acceptedMutationId: crypto.randomUUID() };
    await h.coordinator.flush();
    expect(h.sync).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.onStatus).toHaveBeenLastCalledWith('conflict');
    expect(h.current.revision).toBe(50);
    h.coordinator.dispose();
  });
  it('keeps a newer edit when the older timed-out snapshot is later acknowledged, including after resume', async () => {
    const h = harness();
    const accept = h.sync.getMockImplementation()!;
    h.sync.mockImplementationOnce(async (snapshot) => {
      h.current = updateDraftAnswer(h.current, 'q', 'b', 0);
      await accept(snapshot);
      throw new Error('lost response');
    });
    await h.coordinator.flush();
    expect(h.current.pendingSnapshot?.revision).toBe(1);
    // Simulate the durable draft being read after reopening with the server ack.
    h.current = reconcileAssessmentDraft(h.server, h.current, questions);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.sync.mockImplementationOnce(async (snapshot) => {
      await blocked;
      return accept(snapshot);
    });
    const recovery = h.coordinator.flush();
    await vi.waitFor(() => expect(h.sync).toHaveBeenCalledTimes(2));
    expect(h.current).toMatchObject({
      revision: 2,
      syncedRevision: 1,
      syncStatus: 'pending',
      answers: [{ selectedChoiceId: 'b' }],
    });
    release();
    await recovery;
    expect(h.current.answers[0].selectedChoiceId).toBe('b');
    expect(h.current.syncedRevision).toBe(2);
    expect(h.onStatus).not.toHaveBeenCalledWith('conflict');
    expect(h.sync).toHaveBeenCalledTimes(2);
    h.coordinator.dispose();
  });
  it('maintains one timer, clears it on triggers/flush/dispose and bounds automatic retries', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.read.mockRejectedValue(new Error('offline'));
    await h.coordinator.flush();
    expect(vi.getTimerCount()).toBe(1);
    h.coordinator.requestSync();
    h.coordinator.requestSync();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    for (const delay of ASSESSMENT_SYNC_RETRY_DELAYS) await vi.advanceTimersByTimeAsync(delay);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.read).toHaveBeenCalledTimes(7);
    await h.coordinator.flush();
    expect(vi.getTimerCount()).toBe(1);
    h.coordinator.dispose();
    expect(vi.getTimerCount()).toBe(0);
    h.coordinator.requestSync();
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.read).toHaveBeenCalledTimes(8);
  });
  it('catches load failures and ignores in-flight responses after disposal', async () => {
    const h = harness();
    let release!: (value: AssessmentAttempt) => void;
    h.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const run = h.coordinator.flush();
    await vi.waitFor(() => expect(h.read).toHaveBeenCalled());
    h.coordinator.dispose();
    release(attempt());
    await run;
    expect(h.sync).not.toHaveBeenCalled();
    expect(h.onCompleted).not.toHaveBeenCalled();
  });
});
