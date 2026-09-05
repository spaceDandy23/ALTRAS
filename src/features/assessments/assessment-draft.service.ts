import type {
  AssessmentAnswer,
  AssessmentAttempt,
  AssessmentDraft,
  AssessmentKind,
  AssessmentQuestion,
} from '@/types/assessment';
import { db, type AltrasDatabase } from '@/db/database';

export const ASSESSMENT_SYNC_RETRY_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

export function assessmentDraftId(userId: string, kind: AssessmentKind, attemptId: string) {
  return `${userId}:${kind}:${attemptId}`;
}

export function createAssessmentDraft(
  attempt: AssessmentAttempt,
  questions: AssessmentQuestion[],
  currentQuestionIndex = 0,
): AssessmentDraft {
  const updatedAt = Math.max(
    Date.now(),
    attempt.startedAt,
    ...attempt.answers.map((answer) => answer.answeredAt),
  );
  return {
    id: assessmentDraftId(attempt.userId, attempt.assessment, attempt.id),
    userId: attempt.userId,
    assessment: attempt.assessment,
    attemptId: attempt.id,
    startedAt: attempt.startedAt,
    contentVersion: attempt.contentVersion,
    expectedQuestionCount: attempt.expectedQuestionCount,
    questions,
    answers: attempt.answers,
    currentQuestionIndex,
    revision: 0,
    syncedRevision: 0,
    updatedAt,
    syncStatus: 'synced',
  };
}

export function draftToAttempt(draft: AssessmentDraft): AssessmentAttempt {
  return {
    id: draft.attemptId,
    userId: draft.userId,
    assessment: draft.assessment,
    status: 'active',
    startedAt: draft.startedAt,
    submittedAt: null,
    score: null,
    completionSeconds: null,
    contentVersion: draft.contentVersion,
    expectedQuestionCount: draft.expectedQuestionCount,
    answers: draft.answers,
  };
}

export function updateDraftAnswer(
  draft: AssessmentDraft,
  questionId: string,
  selectedChoiceId: string,
  now = Date.now(),
): AssessmentDraft {
  const answer: AssessmentAnswer = { questionId, selectedChoiceId, answeredAt: now };
  const answers = draft.answers.filter((current) => current.questionId !== questionId);
  return {
    ...draft,
    answers: [...answers, answer],
    revision: draft.revision + 1,
    updatedAt: now,
    syncStatus: 'pending',
  };
}

export function updateDraftPosition(
  draft: AssessmentDraft,
  currentQuestionIndex: number,
  now = Date.now(),
): AssessmentDraft {
  return { ...draft, currentQuestionIndex, updatedAt: now };
}

export function markDraftPendingSubmission(
  draft: AssessmentDraft,
  now = Date.now(),
): AssessmentDraft {
  return {
    ...draft,
    revision: draft.revision + 1,
    updatedAt: now,
    syncStatus: 'pending_submission',
  };
}

export async function saveAssessmentDraft(
  draft: AssessmentDraft,
  database: AltrasDatabase = db,
) {
  await database.assessmentDrafts.put(draft);
}

export async function getAssessmentDraft(
  userId: string,
  kind: AssessmentKind,
  database: AltrasDatabase = db,
): Promise<AssessmentDraft | null> {
  const drafts = await database.assessmentDrafts
    .where('[userId+assessment]')
    .equals([userId, kind])
    .toArray();
  return drafts.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
}

export async function deleteAssessmentDraft(id: string, database: AltrasDatabase = db) {
  await database.assessmentDrafts.delete(id);
}

export async function markAssessmentDraftSynced(
  id: string,
  revision: number,
  database: AltrasDatabase = db,
) {
  await database.transaction('rw', database.assessmentDrafts, async () => {
    const current = await database.assessmentDrafts.get(id);
    if (!current || current.revision !== revision || current.syncStatus === 'pending_submission') {
      return;
    }
    await database.assessmentDrafts.put({
      ...current,
      syncedRevision: revision,
      syncStatus: 'synced',
    });
  });
}

export function reconcileAssessmentDraft(
  serverAttempt: AssessmentAttempt,
  localDraft: AssessmentDraft | null,
  questions: AssessmentQuestion[],
): AssessmentDraft {
  const serverUpdatedAt = Math.max(
    serverAttempt.startedAt,
    ...serverAttempt.answers.map((answer) => answer.answeredAt),
  );
  if (
    localDraft?.attemptId === serverAttempt.id &&
    localDraft.userId === serverAttempt.userId &&
    (localDraft.syncStatus === 'pending_submission' ||
      (localDraft.revision > localDraft.syncedRevision && localDraft.updatedAt > serverUpdatedAt))
  ) {
    return { ...localDraft, questions: questions.length > 0 ? questions : localDraft.questions };
  }
  return createAssessmentDraft(serverAttempt, questions, localDraft?.currentQuestionIndex ?? 0);
}

interface SynchronizerOptions {
  load: () => Promise<AssessmentDraft | null>;
  sync: (draft: AssessmentDraft) => Promise<void>;
  markSynced: (id: string, revision: number) => Promise<void>;
  onStatus?: (status: 'syncing' | 'synced' | 'pending') => void;
  retryDelays?: readonly number[];
}

export class AssessmentDraftSynchronizer {
  private running: Promise<void> | null = null;
  private requested = false;
  private retryIndex = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly options: SynchronizerOptions) {}

  requestSync(resetRetryBurst = true) {
    if (this.disposed) return;
    if (resetRetryBurst) this.retryIndex = 0;
    this.requested = true;
    if (!this.running) this.startDrain();
  }

  async flush() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.running) await this.running;
    const draft = await this.options.load();
    if (!draft || draft.syncStatus === 'synced') return;
    this.options.onStatus?.('syncing');
    await this.options.sync(draft);
    await this.options.markSynced(draft.id, draft.revision);
    this.options.onStatus?.('synced');
  }

  dispose() {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private startDrain() {
    this.running = this.drain().finally(() => {
      this.running = null;
      if (this.requested && !this.disposed) this.startDrain();
    });
  }

  private async drain() {
    while (this.requested && !this.disposed) {
      this.requested = false;
      const draft = await this.options.load();
      if (!draft || draft.syncStatus === 'synced') continue;
      this.options.onStatus?.('syncing');
      try {
        await this.options.sync(draft);
        await this.options.markSynced(draft.id, draft.revision);
        this.retryIndex = 0;
        this.options.onStatus?.('synced');
        const latest = await this.options.load();
        if (latest && latest.revision > draft.revision) this.requested = true;
      } catch {
        this.options.onStatus?.('pending');
        this.scheduleRetry();
      }
    }
  }

  private scheduleRetry() {
    const delays = this.options.retryDelays ?? ASSESSMENT_SYNC_RETRY_DELAYS;
    const delay = delays[this.retryIndex];
    if (delay === undefined || this.disposed) return;
    this.retryIndex += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.requested = true;
      if (!this.running) this.startDrain();
    }, delay);
  }
}
