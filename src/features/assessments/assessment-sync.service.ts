import { db } from '@/db/database';
import { captureSyncSession, requireSyncSession } from '@/services/sync-session';
import type { AssessmentDraft } from '@/types/assessment';
import {
  AssessmentDraftSynchronizer,
  acknowledgeAssessmentStart,
  deleteAssessmentDraft,
  discoverPendingAssessmentDrafts,
  saveAssessmentDraft,
} from './assessment-draft.service';
import {
  completeAssessment,
  getAssessmentAttempt,
  startAssessment,
  syncAssessmentDraft,
  type AssessmentScope,
} from './assessment.service';

const pendingAssessmentFlushes = new Map<string, Promise<void>>();

const scopeFor = (draft: AssessmentDraft): AssessmentScope | undefined =>
  draft.lessonId && draft.lessonAttemptId
    ? { lessonId: draft.lessonId, lessonAttemptId: draft.lessonAttemptId }
    : undefined;

async function flushPendingAssessmentDraftOnce(
  initial: AssessmentDraft,
  isCurrent: () => boolean,
): Promise<void> {
  const check = () => requireSyncSession(isCurrent);
  let currentId = initial.id;
  const synchronizer = new AssessmentDraftSynchronizer({
    isCurrent,
    attemptId: initial.attemptId,
    load: () => db.assessmentDrafts.get(currentId).then((draft) => draft ?? null),
    start: (draft) =>
      startAssessment(draft.userId, draft.assessment, scopeFor(draft), draft.attemptId, check),
    acknowledgeStart: async (snapshot, server) => {
      const next = await acknowledgeAssessmentStart(snapshot, server);
      currentId = next.id;
    },
    read: (draft) => getAssessmentAttempt(draft.userId, draft.assessment, scopeFor(draft)),
    sync: (draft) => syncAssessmentDraft(draft, check),
    beforeSync: async (snapshot) => {
      const current = await db.assessmentDrafts.get(currentId);
      if (!current || current.revision !== snapshot.revision) return;
      await saveAssessmentDraft({
        ...current,
        pendingSnapshot: snapshot.mutationId
          ? { revision: snapshot.revision, mutationId: snapshot.mutationId }
          : undefined,
      });
    },
    complete: (draft) =>
      completeAssessment(
        draft.userId,
        draft.assessment,
        draft.attemptId,
        draft.revision,
        scopeFor(draft),
        check,
        draft.answeringSeconds ?? 0,
      ),
    acknowledge: async (snapshot) => {
      const current = await db.assessmentDrafts.get(currentId);
      if (!current) return;
      await saveAssessmentDraft({
        ...current,
        pendingSnapshot: undefined,
        syncedRevision: Math.max(current.syncedRevision, snapshot.revision),
        syncStatus:
          current.syncStatus === 'pending_submission'
            ? 'pending_submission'
            : current.revision === snapshot.revision
              ? 'synced'
              : 'pending',
      });
    },
    onCompleted: async (snapshot, server) => {
      if (server.status !== 'submitted') throw new Error('Assessment completion is not confirmed.');
      if (
        server.submittedRevision !== snapshot.revision ||
        server.acceptedMutationId !== snapshot.mutationId
      ) {
        throw new Error('The official result does not match this saved submission.');
      }
      await deleteAssessmentDraft(currentId, snapshot.revision, snapshot.mutationId);
    },
    retryDelays: [],
  });
  try {
    await synchronizer.flush();
  } finally {
    synchronizer.dispose();
  }
  const remaining = await db.assessmentDrafts.get(currentId);
  if (remaining?.pendingStart || (remaining && remaining.syncStatus !== 'synced')) {
    throw new Error('Saved assessment work is still syncing.');
  }
}

export function flushPendingAssessmentDraft(draft: AssessmentDraft): Promise<void> {
  const isCurrent = captureSyncSession(draft.userId);
  const key = `${draft.userId}:${draft.attemptId}`;
  const previous = pendingAssessmentFlushes.get(key);
  const operation = (async () => {
    await previous?.catch(() => undefined);
    requireSyncSession(isCurrent);
    await flushPendingAssessmentDraftOnce(draft, isCurrent);
  })().finally(() => {
    if (pendingAssessmentFlushes.get(key) === operation) {
      pendingAssessmentFlushes.delete(key);
    }
  });
  pendingAssessmentFlushes.set(key, operation);
  return operation;
}

export async function syncPendingAssessmentDrafts(
  userId: string,
  excludedAttemptIds: ReadonlySet<string> = new Set(),
  onWorkFound?: (attemptCount: number) => void,
  excludedScope?: { assessment: AssessmentDraft['assessment']; lessonAttemptId?: string },
): Promise<{ attempts: number; failed: number; pending: number; invalid: number }> {
  const isCurrent = captureSyncSession(userId);
  requireSyncSession(isCurrent);
  const discovery = await discoverPendingAssessmentDrafts(userId);
  requireSyncSession(isCurrent);
  const isExcluded = (draft: AssessmentDraft) =>
    // Lesson questions stay local while editable; replay their frozen submission.
    (Boolean(draft.lessonAttemptId) && draft.syncStatus !== 'pending_submission') ||
    excludedAttemptIds.has(draft.attemptId) ||
    (excludedScope?.assessment === draft.assessment &&
      excludedScope.lessonAttemptId === draft.lessonAttemptId);
  const drafts = discovery.drafts.filter((draft) => !isExcluded(draft));
  if (drafts.length) onWorkFound?.(drafts.length);
  const results = await Promise.allSettled(
    drafts.map((draft) => flushPendingAssessmentDraft(draft)),
  );
  const after = await discoverPendingAssessmentDrafts(userId);
  return {
    attempts: drafts.length,
    failed: results.filter((result) => result.status === 'rejected').length,
    pending: after.drafts.filter((draft) => !isExcluded(draft)).length,
    invalid: after.invalidDraftIds.length,
  };
}
