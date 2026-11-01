import { db, type AltrasDatabase } from '@/db/database';
import { captureSyncSession, requireSyncSession } from '@/services/sync-session';
import type { LessonAttempt } from '@/types/learning';
import type { ActivityAnswer } from '../domain/evaluation';
import type { LessonFlowStage } from '../domain/lesson-flow';
import { getAssessmentQuestions } from '@/features/assessments/assessment.service';
import { getAssessmentDraft } from '@/features/assessments/assessment-draft.service';
import { flushPendingAssessmentDraft } from '@/features/assessments/assessment-sync.service';
import type { LessonAttemptLaunchMode } from './attempt-launch';
import { ensureUserLessonProgress } from '../progress/progress.service';
import { getLesson } from '../content/content.service';
import {
  LessonDraftSynchronizer,
  acknowledgeLessonActiveTime,
  acknowledgeLessonCompletion,
  acknowledgeLessonAnswer,
  acknowledgeLessonStageTransition,
  createLessonDraft,
  discoverPendingLessonDrafts,
  getLessonDraft,
  lessonDraftId,
  queueLessonStageTransition,
  saveLessonDraft,
  reconcileLessonDraft,
  type LessonDraft,
} from './lesson-draft.service';
import {
  completeOnlineAttempt,
  advanceOnlineAttemptStage,
  getOnlineActiveAttempt,
  getOnlineAttempt,
  prepareOnlineAttempt,
  recordOnlineActiveSeconds,
  restartOnlineAttempt,
  submitOnlineActivityAnswer,
} from './online-attempt.service';

export type { LessonAttemptLaunchMode } from './attempt-launch';

export { AttemptError } from './attempt.errors';

const pendingLaunchModes = new Map<string, LessonAttemptLaunchMode>();
const pendingLessonFlushes = new Map<string, Promise<void>>();

async function cacheLessonAttemptPackage(
  database: AltrasDatabase,
  userId: string,
  attempt: LessonAttempt,
): Promise<void> {
  if (!attempt.preAssessmentVersion && !attempt.postAssessmentVersion) return;
  const scope = { lessonId: attempt.lessonId, lessonAttemptId: attempt.id };
  const [lesson, preTest, postTest, existing] = await Promise.all([
    getLesson(database, attempt.lessonId, attempt.id),
    attempt.preAssessmentVersion ? getAssessmentQuestions('pre-test', scope) : Promise.resolve([]),
    attempt.postAssessmentVersion
      ? getAssessmentQuestions('post-test', scope)
      : Promise.resolve([]),
    getLessonDraft(userId, attempt.lessonId, attempt.id, database),
  ]);
  const draft = existing
    ? reconcileLessonDraft(attempt, lesson, existing)
    : createLessonDraft(attempt, lesson, attempt.answers.length, {
        ...(preTest.length ? { 'pre-test': preTest } : {}),
        ...(postTest.length ? { 'post-test': postTest } : {}),
      });
  draft.assessmentQuestions = {
    ...draft.assessmentQuestions,
    ...(preTest.length ? { 'pre-test': preTest } : {}),
    ...(postTest.length ? { 'post-test': postTest } : {}),
  };
  await saveLessonDraft(draft, database);
}

export async function getActiveAttempt(
  _database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonAttempt | null> {
  return getOnlineActiveAttempt(userId, lessonId);
}

export async function startOrResumeAttempt(
  database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonAttempt> {
  await assertNoPendingResult(database, userId, lessonId);
  const launch = await prepareOnlineAttempt(database, userId, lessonId);
  await cacheLessonAttemptPackage(database, userId, launch.attempt);
  pendingLaunchModes.set(launch.attempt.id, launch.mode);
  return launch.attempt;
}

export function consumeLessonAttemptLaunchMode(attemptId: string) {
  const mode = pendingLaunchModes.get(attemptId) ?? 'resume';
  pendingLaunchModes.delete(attemptId);
  return mode;
}

export async function restartAttempt(
  database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonAttempt> {
  await assertNoPendingResult(database, userId, lessonId);
  const attempt = await restartOnlineAttempt(database, userId, lessonId);
  await cacheLessonAttemptPackage(database, userId, attempt);
  pendingLaunchModes.set(attempt.id, 'retry');
  return attempt;
}

export async function submitActivityAnswer(
  database: AltrasDatabase,
  attemptId: string,
  activityId: string,
  answer: ActivityAnswer,
  currentAttempt?: LessonAttempt,
): Promise<LessonAttempt> {
  const isCurrent = captureSyncSession();
  return submitOnlineActivityAnswer(database, attemptId, activityId, answer, currentAttempt, () =>
    requireSyncSession(isCurrent),
  );
}

export async function completeAttempt(
  database: AltrasDatabase,
  attemptId: string,
): Promise<LessonAttempt> {
  const isCurrent = captureSyncSession();
  return completeOnlineAttempt(database, attemptId, () => requireSyncSession(isCurrent));
}

export async function advanceAttemptStage(
  attemptId: string,
  expectedStage: LessonFlowStage,
  expectedChapterId: string | null,
): Promise<LessonAttempt> {
  const isCurrent = captureSyncSession();
  const check = () => requireSyncSession(isCurrent);
  check();
  if (expectedStage === 'pre-test' || expectedStage === 'post-test') {
    const lesson = await db.lessonDrafts.where('attemptId').equals(attemptId).first();
    check();
    if (lesson) {
      requireSyncSession(captureSyncSession(lesson.userId));
      const assessment = await getAssessmentDraft(lesson.userId, expectedStage, db, attemptId);
      check();
      if (assessment) await flushPendingAssessmentDraft(assessment);
    }
  }
  check();
  return advanceOnlineAttemptStage(attemptId, expectedStage, expectedChapterId, check);
}

async function assertNoPendingResult(database: AltrasDatabase, userId: string, lessonId: string) {
  const drafts = await database.lessonDrafts
    .where('[userId+lessonId]')
    .equals([userId, lessonId])
    .toArray();
  if (drafts.some((draft) => draft.pendingCompletion)) {
    throw new Error('Results pending sync. Reconnect before starting another attempt.');
  }
}

export async function queueAttemptStageTransition(
  userId: string,
  lessonId: string,
  attemptId: string,
  expectedStage?: LessonFlowStage,
): Promise<LessonDraft> {
  const id = lessonDraftId(userId, lessonId, attemptId);
  const existing = await getLessonDraft(userId, lessonId, attemptId);
  if (!existing) {
    const [attempt, lesson] = await Promise.all([
      getOnlineAttempt(userId, attemptId),
      getLesson(db, lessonId, attemptId),
    ]);
    if (attempt.lessonId !== lesson.id) throw new Error('Attempt mismatch.');
    await saveLessonDraft(createLessonDraft(attempt, lesson));
  }
  return queueLessonStageTransition(id, db, Date.now(), expectedStage);
}

export async function flushPendingLessonAttempt(
  userId: string,
  lessonId: string,
  attemptId: string,
): Promise<void> {
  const isCurrent = captureSyncSession(userId);
  const key = `${userId}:${attemptId}`;
  const previous = pendingLessonFlushes.get(key);
  const operation = (async () => {
    await previous?.catch(() => undefined);
    requireSyncSession(isCurrent);
    await flushPendingLessonAttemptOnce(userId, lessonId, attemptId, isCurrent);
  })().finally(() => {
    if (pendingLessonFlushes.get(key) === operation) pendingLessonFlushes.delete(key);
  });
  pendingLessonFlushes.set(key, operation);
  return operation;
}

async function flushPendingLessonAttemptOnce(
  userId: string,
  lessonId: string,
  attemptId: string,
  isCurrent: () => boolean,
): Promise<void> {
  const check = () => requireSyncSession(isCurrent);
  const synchronizer = new LessonDraftSynchronizer({
    isCurrent,
    attemptId,
    load: () => getLessonDraft(userId, lessonId, attemptId),
    recordActiveTime: (_draft, segment) =>
      recordOnlineActiveSeconds(attemptId, segment.seconds, segment.id),
    acknowledgeActiveTime: (draft, segment) =>
      acknowledgeLessonActiveTime(draft.id, segment.id).then(() => undefined),
    advanceStage: (_draft, transition) =>
      advanceAttemptStage(attemptId, transition.fromStage, transition.fromChapterId),
    acknowledgeStage: (draft, transition, attempt) =>
      acknowledgeLessonStageTransition(draft.id, transition, attempt).then(() => undefined),
    submit: (draft, answer) =>
      submitOnlineActivityAnswer(
        db,
        attemptId,
        answer.activityId,
        answer.answer,
        draft.attempt,
        check,
      ),
    acknowledge: (draft, answer, attempt) =>
      acknowledgeLessonAnswer(draft.id, answer, attempt).then(() => undefined),
    complete: () => completeOnlineAttempt(db, attemptId, check),
    onCompleted: (draft, attempt) => acknowledgeLessonCompletion(draft, attempt),
    retryDelays: [],
  });
  try {
    await synchronizer.flush();
  } finally {
    synchronizer.dispose();
  }
  const remaining = await getLessonDraft(userId, lessonId, attemptId);
  if (
    remaining?.pendingAnswers.length ||
    remaining?.pendingActiveTimeSegments.length ||
    remaining?.pendingStageTransitions.length ||
    remaining?.pendingCompletion
  ) {
    throw new Error('Saved lesson work is still syncing. Reconnect and try again.');
  }
}

export async function syncPendingLessonDrafts(
  userId: string,
  excludedAttemptIds: ReadonlySet<string> = new Set(),
  onWorkFound?: (attemptCount: number) => void,
): Promise<{ attempts: number; failed: number; pending: number; invalid: number }> {
  const isCurrent = captureSyncSession(userId);
  requireSyncSession(isCurrent);
  const discovery = await discoverPendingLessonDrafts(userId);
  requireSyncSession(isCurrent);
  const drafts = discovery.drafts.filter((draft) => !excludedAttemptIds.has(draft.attemptId));
  if (drafts.length > 0) onWorkFound?.(drafts.length);
  const results = await Promise.allSettled(
    drafts.map((draft) => flushPendingLessonAttempt(userId, draft.lessonId, draft.attemptId)),
  );
  const after = await discoverPendingLessonDrafts(userId);
  return {
    attempts: drafts.length,
    failed: results.filter((result) => result.status === 'rejected').length,
    pending: after.drafts.filter((draft) => !excludedAttemptIds.has(draft.attemptId)).length,
    invalid: after.invalidDraftIds.length,
  };
}

export async function getAttempt(
  _database: AltrasDatabase,
  userId: string,
  attemptId: string,
): Promise<LessonAttempt> {
  return getOnlineAttempt(userId, attemptId);
}

export async function ensureLearningReady(database: AltrasDatabase, userId: string): Promise<void> {
  await ensureUserLessonProgress(database, userId);
}

export async function recordAttemptActiveSeconds(
  _database: AltrasDatabase,
  attemptId: string,
  seconds: number,
  segmentId: string,
): Promise<void> {
  await recordOnlineActiveSeconds(attemptId, seconds, segmentId);
}
