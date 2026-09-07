import {
  assessmentAttemptSchema,
  assessmentQuestionSchema,
  type AssessmentAttempt,
  type AssessmentDraft,
  type AssessmentKind,
  type AssessmentQuestion,
} from '@/types/assessment';
import { db, type AltrasDatabase } from '@/db/database';

export const ASSESSMENT_SYNC_RETRY_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
export const assessmentDraftId = (userId: string, kind: AssessmentKind, attemptId: string) =>
  `${userId}:${kind}:${attemptId}`;

export function validateAssessmentContent(
  attempt: AssessmentAttempt,
  questions: AssessmentQuestion[],
) {
  assessmentAttemptSchema.parse(attempt);
  if (
    !questions.length ||
    questions.length !== attempt.expectedQuestionCount ||
    new Set(questions.map((q) => q.id)).size !== questions.length
  ) {
    throw new Error('The test questions are incomplete. Please retry.');
  }
  for (const question of questions) {
    assessmentQuestionSchema.parse(question);
    if (
      question.assessment !== attempt.assessment ||
      question.contentVersion !== attempt.contentVersion ||
      new Set(question.choices.map((c) => c.id)).size !== question.choices.length
    ) {
      throw new Error('The saved test content does not match this attempt.');
    }
  }
  if (
    new Set(attempt.answers.map((a) => a.questionId)).size !== attempt.answers.length ||
    attempt.answers.some(
      (a) =>
        !questions.some(
          (q) => q.id === a.questionId && q.choices.some((c) => c.id === a.selectedChoiceId),
        ),
    )
  ) {
    throw new Error('The saved test contains invalid answers.');
  }
}

export function createAssessmentDraft(
  attempt: AssessmentAttempt,
  questions: AssessmentQuestion[],
  currentQuestionIndex = 0,
): AssessmentDraft {
  validateAssessmentContent(attempt, questions);
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
    currentQuestionIndex: Math.max(0, Math.min(currentQuestionIndex, questions.length - 1)),
    revision: attempt.acceptedRevision ?? 0,
    syncedRevision: attempt.acceptedRevision ?? 0,
    mutationId: attempt.acceptedMutationId ?? crypto.randomUUID(),
    updatedAt: Date.now(),
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
    acceptedRevision: draft.syncedRevision,
  };
}

export function validateLocalDraft(draft: AssessmentDraft, userId: string, kind: AssessmentKind) {
  if (
    draft.userId !== userId ||
    draft.assessment !== kind ||
    draft.id !== assessmentDraftId(userId, kind, draft.attemptId) ||
    !Number.isSafeInteger(draft.revision) ||
    !Number.isSafeInteger(draft.syncedRevision) ||
    draft.syncedRevision < 0 ||
    draft.revision < draft.syncedRevision ||
    !Number.isInteger(draft.currentQuestionIndex) ||
    !['synced', 'pending', 'pending_submission'].includes(draft.syncStatus)
  ) {
    throw new Error('The local test draft is invalid or belongs to another session.');
  }
  validateAssessmentContent(draftToAttempt(draft), draft.questions);
  if (
    draft.pendingSnapshot &&
    (!Number.isSafeInteger(draft.pendingSnapshot.revision) ||
      draft.pendingSnapshot.revision > draft.revision ||
      draft.pendingSnapshot.revision <= draft.syncedRevision ||
      !draft.pendingSnapshot.mutationId)
  ) {
    throw new Error('The pending snapshot revision is invalid.');
  }
}

export function updateDraftAnswer(
  draft: AssessmentDraft,
  questionId: string,
  selectedChoiceId: string,
  now = Date.now(),
): AssessmentDraft {
  return {
    ...draft,
    answers: [
      ...draft.answers.filter((a) => a.questionId !== questionId),
      { questionId, selectedChoiceId, answeredAt: now },
    ],
    revision: draft.revision + 1,
    mutationId: crypto.randomUUID(),
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
export function markDraftPendingSubmission(draft: AssessmentDraft): AssessmentDraft {
  // Submission intent is metadata, not a new answer snapshot.
  return {
    ...draft,
    revision: draft.revision === 0 ? 1 : draft.revision,
    syncStatus: 'pending_submission',
  };
}

export async function saveAssessmentDraft(draft: AssessmentDraft, database: AltrasDatabase = db) {
  await database.transaction('rw', database.assessmentDrafts, async () => {
    const previous = await database.assessmentDrafts.get(draft.id);
    if (
      previous &&
      (previous.revision > draft.revision ||
        (previous.revision === draft.revision &&
          previous.mutationId &&
          previous.mutationId !== draft.mutationId))
    ) {
      throw new Error('Another tab changed the local draft. Your answers remain in this window.');
    }
    await database.assessmentDrafts.put(draft);
  });
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
  if (drafts.length > 1)
    throw new Error('Multiple local attempts were found. The local drafts have been preserved.');
  const draft = drafts[0] ?? null;
  if (draft) validateLocalDraft(draft, userId, kind);
  return draft;
}
export async function deleteAssessmentDraft(
  id: string,
  revision: number,
  mutationId: string | undefined,
  database: AltrasDatabase = db,
) {
  return database.transaction('rw', database.assessmentDrafts, async () => {
    const current = await database.assessmentDrafts.get(id);
    if (!current) return true;
    if (current.revision !== revision || current.mutationId !== mutationId) return false;
    await database.assessmentDrafts.delete(id);
    return true;
  });
}

// Explicit user-directed conflict resolution; never automatically discard edits.
export async function replaceAssessmentDraft(
  expected: AssessmentDraft | null,
  replacement: AssessmentDraft,
  database: AltrasDatabase = db,
) {
  return database.transaction('rw', database.assessmentDrafts, async () => {
    const current = await database.assessmentDrafts.get(replacement.id);
    if (current?.revision !== expected?.revision || current?.mutationId !== expected?.mutationId)
      throw new Error('The local draft changed again. Please retry.');
    await database.assessmentDrafts.put(replacement);
  });
}

export function reconcileAssessmentDraft(
  server: AssessmentAttempt,
  local: AssessmentDraft | null,
  questions: AssessmentQuestion[],
): AssessmentDraft {
  const clean = createAssessmentDraft(server, questions, local?.currentQuestionIndex ?? 0);
  if (!local) return clean;
  validateLocalDraft(local, server.userId, server.assessment);
  if (local.attemptId !== server.id || local.contentVersion !== server.contentVersion)
    throw new Error('The local draft belongs to a different attempt or content version.');
  if (!server.acceptedMutationId && clean.revision === local.revision)
    clean.mutationId = local.mutationId ?? clean.mutationId;
  if (
    local.revision === server.acceptedRevision &&
    local.mutationId === server.acceptedMutationId
  ) {
    return {
      ...clean,
      syncStatus: local.syncStatus === 'pending_submission' ? 'pending_submission' : 'synced',
    };
  }
  if (local.revision > local.syncedRevision || local.syncStatus === 'pending_submission') {
    return {
      ...local,
      questions,
      mutationId: local.mutationId ?? crypto.randomUUID(),
      currentQuestionIndex: clean.currentQuestionIndex,
    };
  }
  return clean;
}

interface SynchronizerOptions {
  load: () => Promise<AssessmentDraft | null>;
  read: (draft: AssessmentDraft) => Promise<AssessmentAttempt | null>;
  sync: (draft: AssessmentDraft) => Promise<AssessmentAttempt>;
  beforeSync?: (snapshot: AssessmentDraft) => Promise<void>;
  complete: (draft: AssessmentDraft) => Promise<AssessmentAttempt>;
  acknowledge: (snapshot: AssessmentDraft, server: AssessmentAttempt) => Promise<void>;
  onCompleted: (snapshot: AssessmentDraft, server: AssessmentAttempt) => Promise<void>;
  onStatus?: (status: 'syncing' | 'synced' | 'pending' | 'conflict', error?: unknown) => void;
  retryDelays?: readonly number[];
}

export class AssessmentDraftSynchronizer {
  private running: Promise<void> | null = null;
  private requested = false;
  private retryIndex = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  constructor(private readonly options: SynchronizerOptions) {}
  private clearRetry() {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
  requestSync(resetRetryBurst = true) {
    if (this.disposed) return;
    this.clearRetry();
    if (resetRetryBurst) this.retryIndex = 0;
    this.requested = true;
    if (!this.running) {
      this.running = Promise.resolve()
        .then(() => this.drain())
        .finally(() => {
          this.running = null;
          if (this.requested && !this.disposed) this.requestSync(false);
        });
    }
  }
  async flush() {
    this.requestSync();
    while (this.running) await this.running;
  }
  dispose() {
    this.disposed = true;
    this.requested = false;
    this.clearRetry();
  }
  private async drain() {
    while (this.requested && !this.disposed) {
      this.requested = false;
      try {
        const snapshot = await this.options.load();
        if (!snapshot || this.disposed || snapshot.syncStatus === 'synced') continue;
        this.options.onStatus?.('syncing');
        // Every retry starts with status, including an ambiguous completion timeout.
        let server = await this.options.read(snapshot);
        if (this.disposed) return;
        if (
          !server ||
          server.id !== snapshot.attemptId ||
          server.userId !== snapshot.userId ||
          server.assessment !== snapshot.assessment
        )
          throw new Error('Unable to confirm this assessment session.');
        if (server.status === 'submitted') {
          await this.options.onCompleted(snapshot, server);
          return;
        }
        // The last sent snapshot may have committed despite its lost response.
        // Its identity survives newer edits and, when durable, page refreshes.
        if (
          snapshot.pendingSnapshot &&
          server.acceptedRevision === snapshot.pendingSnapshot.revision &&
          server.acceptedMutationId === snapshot.pendingSnapshot.mutationId
        ) {
          await this.options.acknowledge(
            {
              ...snapshot,
              revision: snapshot.pendingSnapshot.revision,
              mutationId: snapshot.pendingSnapshot.mutationId,
            },
            server,
          );
          this.requested = true;
          continue;
        }
        if (
          server.acceptedRevision !== snapshot.revision ||
          server.acceptedMutationId !== snapshot.mutationId
        ) {
          if ((server.acceptedRevision ?? 0) !== snapshot.syncedRevision) {
            this.options.onStatus?.('conflict');
            this.requested = false;
            return;
          }
          await this.options.beforeSync?.(snapshot);
          if (this.disposed) return;
          server = await this.options.sync(snapshot);
          if (this.disposed) return;
        }
        if (server.status === 'submitted') {
          await this.options.onCompleted(snapshot, server);
          return;
        }
        if (
          server.acceptedRevision !== snapshot.revision ||
          server.acceptedMutationId !== snapshot.mutationId
        ) {
          this.options.onStatus?.('conflict');
          this.requested = false;
          return;
        }
        await this.options.acknowledge(snapshot, server);
        if (this.disposed) return;
        const latest = await this.options.load();
        if (!latest || this.disposed) return;
        if (latest.revision !== snapshot.revision || latest.mutationId !== snapshot.mutationId) {
          this.requested = true;
          continue;
        }
        if (latest.syncStatus === 'pending_submission') {
          try {
            server = await this.options.complete(latest);
          } catch (cause) {
            const recovered = await this.options.read(latest);
            if (recovered?.status !== 'submitted') throw cause;
            server = recovered;
          }
          if (this.disposed) return;
          if (server.status !== 'submitted') throw new Error('Submission is not yet confirmed.');
          await this.options.onCompleted(latest, server);
          return;
        }
        this.retryIndex = 0;
        this.options.onStatus?.('synced');
      } catch (error) {
        if (this.disposed) return;
        this.options.onStatus?.('pending', error);
        this.requested = false;
        this.scheduleRetry();
      }
    }
  }
  private scheduleRetry() {
    this.clearRetry();
    const delays = this.options.retryDelays ?? ASSESSMENT_SYNC_RETRY_DELAYS;
    const delay = delays[this.retryIndex++];
    if (delay === undefined || this.disposed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.requestSync(false);
    }, delay);
  }
}
