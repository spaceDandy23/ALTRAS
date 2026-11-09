import type { AltrasDatabase } from '@/db/database';
import { db } from '@/db/database';
import type { LessonAttempt } from '@/types/learning';
import type { LearningLesson } from '../domain/content.schemas';
import type { AssessmentKind, AssessmentQuestion } from '@/types/assessment';
import type { ActivityAnswer } from '../domain/evaluation';
import {
  lessonChapters,
  lessonFlowPosition,
  nextLessonFlowState,
  type LessonFlowStage,
} from '../domain/lesson-flow';

export type LessonDraftSyncStatus = 'synced' | 'pending' | 'pending_completion';

export interface LessonPendingAnswer {
  activityId: string;
  activityType: 'find-word' | 'organize-translate' | 'choose-correct-translation';
  answer: ActivityAnswer;
  queuedAt: number;
  sequence?: number;
}

export interface LessonPendingActiveTimeSegment {
  id: string;
  seconds: number;
  queuedAt: number;
}

export interface LessonPendingStageTransition {
  fromStage: LessonFlowStage;
  fromChapterId: string | null;
  toStage: LessonFlowStage;
  toChapterId: string | null;
  queuedAt: number;
  sequence: number;
}

export interface LessonDraft {
  id: string;
  userId: string;
  lessonId: string;
  attemptId: string;
  contentVersion: number;
  lesson: LearningLesson;
  assessmentQuestions: Partial<Record<AssessmentKind, AssessmentQuestion[]>>;
  attempt: LessonAttempt;
  pendingAnswers: LessonPendingAnswer[];
  pendingActiveTimeSegments: LessonPendingActiveTimeSegment[];
  pendingStageTransitions: LessonPendingStageTransition[];
  currentActivityIndex: number;
  pendingCompletion: boolean;
  revision: number;
  updatedAt: number;
  syncStatus: LessonDraftSyncStatus;
}

export const LESSON_SYNC_RETRY_DELAYS = [1_000, 3_000, 10_000, 30_000] as const;

export function lessonDraftId(userId: string, lessonId: string, attemptId: string): string {
  return `${userId}:${lessonId}:${attemptId}`;
}

function normalizeLessonDraft(draft: LessonDraft): LessonDraft {
  return {
    ...draft,
    assessmentQuestions: draft.assessmentQuestions ?? {},
    pendingActiveTimeSegments:
      draft.pendingActiveTimeSegments === undefined ? [] : draft.pendingActiveTimeSegments,
    pendingStageTransitions:
      draft.pendingStageTransitions === undefined ? [] : draft.pendingStageTransitions,
  };
}

function validateLessonDraft(draft: LessonDraft): void {
  if (
    draft.id !== lessonDraftId(draft.userId, draft.lessonId, draft.attemptId) ||
    draft.attempt.userId !== draft.userId ||
    draft.attempt.id !== draft.attemptId ||
    draft.attempt.lessonId !== draft.lessonId ||
    draft.lesson.id !== draft.lessonId ||
    draft.lesson.contentVersion !== draft.contentVersion ||
    draft.attempt.contentVersion !== draft.contentVersion ||
    !Number.isSafeInteger(draft.revision) ||
    draft.revision < 0 ||
    !Number.isInteger(draft.currentActivityIndex) ||
    draft.currentActivityIndex < 0 ||
    draft.currentActivityIndex >= draft.lesson.activities.length ||
    Object.entries(draft.assessmentQuestions).some(([kind, questions]) => {
      const expectedVersion =
        kind === 'pre-test'
          ? draft.attempt.preAssessmentVersion
          : draft.attempt.postAssessmentVersion;
      return (
        !Array.isArray(questions) ||
        questions.length === 0 ||
        questions.some(
          (question) => question.assessment !== kind || question.contentVersion !== expectedVersion,
        )
      );
    }) ||
    new Set(draft.pendingAnswers.map((answer) => answer.activityId)).size !==
      draft.pendingAnswers.length ||
    new Set(draft.pendingActiveTimeSegments.map((segment) => segment.id)).size !==
      draft.pendingActiveTimeSegments.length ||
    draft.pendingStageTransitions.some(
      (transition) =>
        !Number.isSafeInteger(transition.sequence) ||
        transition.sequence <= 0 ||
        lessonFlowPosition(draft.lesson, transition.fromStage, transition.fromChapterId) < 0 ||
        lessonFlowPosition(draft.lesson, transition.toStage, transition.toChapterId) <=
          lessonFlowPosition(draft.lesson, transition.fromStage, transition.fromChapterId),
    ) ||
    draft.pendingActiveTimeSegments.some(
      (segment) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          segment.id,
        ) ||
        !Number.isInteger(segment.seconds) ||
        segment.seconds <= 0 ||
        segment.seconds > 3600 ||
        !Number.isSafeInteger(segment.queuedAt) ||
        segment.queuedAt < 0,
    ) ||
    draft.pendingAnswers.some((answer) => {
      const activity = draft.lesson.activities.find((item) => item.id === answer.activityId);
      if (!activity || activity.type !== answer.activityType) return true;
      if (activity.type === 'find-word') {
        return (
          typeof answer.answer !== 'string' ||
          !activity.choices.some((choice) => choice.id === answer.answer)
        );
      }
      if (activity.type === 'choose-correct-translation') {
        return (
          typeof answer.answer !== 'string' ||
          !activity.choices.some((choice) => choice.id === answer.answer)
        );
      }
      return (
        !Array.isArray(answer.answer) ||
        answer.answer.length !== activity.tokens.length ||
        new Set(answer.answer).size !== activity.tokens.length ||
        answer.answer.some((tokenId) => !activity.tokens.some((token) => token.id === tokenId))
      );
    })
  ) {
    throw new Error('The local lesson draft is invalid or belongs to another session.');
  }
}

export function createLessonDraft(
  attempt: LessonAttempt,
  lesson: LearningLesson,
  currentActivityIndex = attempt.answers.length,
  assessmentQuestions: Partial<Record<AssessmentKind, AssessmentQuestion[]>> = {},
): LessonDraft {
  if (
    attempt.userId.length === 0 ||
    attempt.lessonId !== lesson.id ||
    attempt.contentVersion !== lesson.contentVersion ||
    lesson.activities.length === 0
  ) {
    throw new Error('The lesson content does not match this attempt.');
  }
  const index = Math.max(0, Math.min(currentActivityIndex, lesson.activities.length - 1));
  return {
    id: lessonDraftId(attempt.userId, lesson.id, attempt.id),
    userId: attempt.userId,
    lessonId: lesson.id,
    attemptId: attempt.id,
    contentVersion: lesson.contentVersion,
    lesson,
    assessmentQuestions,
    attempt,
    pendingAnswers: [],
    pendingActiveTimeSegments: [],
    pendingStageTransitions: [],
    currentActivityIndex: index,
    pendingCompletion: false,
    revision: 0,
    updatedAt: Date.now(),
    syncStatus: 'synced',
  };
}

export function reconcileLessonDraft(
  attempt: LessonAttempt,
  lesson: LearningLesson,
  local: LessonDraft | null,
): LessonDraft {
  const clean = createLessonDraft(attempt, lesson, local?.currentActivityIndex);
  if (!local) return clean;
  const current = normalizeLessonDraft(local);
  validateLessonDraft(current);
  if (
    current.userId !== attempt.userId ||
    current.attemptId !== attempt.id ||
    current.contentVersion !== attempt.contentVersion
  ) {
    throw new Error('The local lesson draft belongs to a different attempt.');
  }
  const confirmed = new Set(attempt.answers.map((answer) => answer.activityId));
  const pendingAnswers = current.pendingAnswers.filter(
    (answer) => !confirmed.has(answer.activityId),
  );
  const serverPosition = lessonFlowPosition(lesson, attempt.flowStage, attempt.currentChapterId);
  const pendingStageTransitions = current.pendingStageTransitions.filter(
    (transition) =>
      lessonFlowPosition(lesson, transition.toStage, transition.toChapterId) > serverPosition,
  );
  return {
    ...current,
    lesson,
    attempt: reconciledAttempt(attempt, pendingStageTransitions),
    pendingAnswers,
    pendingStageTransitions,
    revision: current.revision + 1,
    updatedAt: Date.now(),
    syncStatus: current.pendingCompletion
      ? 'pending_completion'
      : pendingAnswers.length > 0 ||
          current.pendingActiveTimeSegments.length > 0 ||
          pendingStageTransitions.length > 0
        ? 'pending'
        : 'synced',
  };
}

export function queueLessonAnswer(
  draft: LessonDraft,
  activityId: string,
  activityType: LessonPendingAnswer['activityType'],
  answer: ActivityAnswer,
  currentActivityIndex: number,
  now = Date.now(),
): LessonDraft {
  validateLessonDraft(draft);
  const activity = draft.lesson.activities.find((item) => item.id === activityId);
  if (!activity || activity.type !== activityType) throw new Error('This activity is unavailable.');
  if (
    draft.attempt.answers.some((item) => item.activityId === activityId) ||
    draft.pendingAnswers.some((item) => item.activityId === activityId)
  ) {
    return draft;
  }
  return {
    ...draft,
    pendingAnswers: [
      ...draft.pendingAnswers,
      {
        activityId,
        activityType,
        answer,
        queuedAt: now,
        sequence: draft.revision + 1,
      },
    ],
    currentActivityIndex: Math.max(
      0,
      Math.min(currentActivityIndex, draft.lesson.activities.length - 1),
    ),
    revision: draft.revision + 1,
    updatedAt: now,
    syncStatus: draft.pendingCompletion ? 'pending_completion' : 'pending',
  };
}

export function updateLessonDraftPosition(
  draft: LessonDraft,
  currentActivityIndex: number,
  now = Date.now(),
): LessonDraft {
  validateLessonDraft(draft);
  return {
    ...draft,
    currentActivityIndex: Math.max(
      0,
      Math.min(currentActivityIndex, draft.lesson.activities.length - 1),
    ),
    revision: draft.revision + 1,
    updatedAt: now,
  };
}

export function markLessonDraftPendingCompletion(
  draft: LessonDraft,
  now = Date.now(),
): LessonDraft {
  validateLessonDraft(draft);
  return {
    ...draft,
    pendingCompletion: true,
    revision: draft.revision + 1,
    updatedAt: now,
    syncStatus: 'pending_completion',
  };
}

export async function queueLessonStageTransition(
  draftId: string,
  database: AltrasDatabase = db,
  now = Date.now(),
  expectedStage?: LessonFlowStage,
): Promise<LessonDraft> {
  return database.transaction('rw', database.lessonDrafts, async () => {
    const stored = await database.lessonDrafts.get(draftId);
    if (!stored) throw new Error('The saved lesson attempt is unavailable.');
    const current = normalizeLessonDraft(stored);
    validateLessonDraft(current);
    if (expectedStage && current.attempt.flowStage !== expectedStage) return current;
    const target = nextLessonFlowState(current.lesson, current.attempt);
    if (!target) throw new Error('This lesson step cannot continue.');
    if (current.attempt.flowStage === 'chapter-activity') {
      const chapter = lessonChapters(current.lesson).find(
        (item) => item.id === current.attempt.currentChapterId,
      );
      const answered = new Set([
        ...current.attempt.answers.map((answer) => answer.activityId),
        ...current.pendingAnswers.map((answer) => answer.activityId),
      ]);
      if (!chapter || chapter.activities.some((activity) => !answered.has(activity.id))) {
        throw new Error('Complete every chapter activity first.');
      }
    }
    const sequence = current.revision + 1;
    const transition: LessonPendingStageTransition = {
      fromStage: current.attempt.flowStage as LessonFlowStage,
      fromChapterId: current.attempt.currentChapterId ?? null,
      toStage: target.flowStage,
      toChapterId: target.currentChapterId,
      queuedAt: now,
      sequence,
    };
    const targetChapter = lessonChapters(current.lesson).find(
      (chapter) => chapter.id === target.currentChapterId,
    );
    const firstTargetActivity = targetChapter?.activities[0];
    const next: LessonDraft = {
      ...current,
      attempt: {
        ...current.attempt,
        flowStage: target.flowStage,
        currentChapterId: target.currentChapterId,
        lastUpdatedAt: Math.max(current.attempt.lastUpdatedAt, now),
      },
      pendingStageTransitions: [...current.pendingStageTransitions, transition],
      currentActivityIndex: firstTargetActivity
        ? Math.max(
            0,
            current.lesson.activities.findIndex(
              (activity) => activity.id === firstTargetActivity.id,
            ),
          )
        : current.currentActivityIndex,
      pendingCompletion: current.pendingCompletion || target.flowStage === 'ready-to-complete',
      revision: sequence,
      updatedAt: now,
      syncStatus:
        current.pendingCompletion || target.flowStage === 'ready-to-complete'
          ? 'pending_completion'
          : 'pending',
    };
    validateLessonDraft(next);
    await database.lessonDrafts.put(next);
    return next;
  });
}

// Read and mutate inside one transaction so a background acknowledgement cannot
// overwrite a newer answer or move the student's current position backwards.
export async function updateStoredLessonDraft(
  draftId: string,
  update: (current: LessonDraft) => LessonDraft,
  database: AltrasDatabase = db,
): Promise<LessonDraft> {
  return database.transaction('rw', database.lessonDrafts, async () => {
    const stored = await database.lessonDrafts.get(draftId);
    if (!stored) throw new Error('The saved lesson attempt is unavailable.');
    const current = normalizeLessonDraft(stored);
    validateLessonDraft(current);
    const next = update(current);
    validateLessonDraft(next);
    await database.lessonDrafts.put(next);
    return next;
  });
}

function reconciledAttempt(
  server: LessonAttempt,
  pendingStageTransitions: LessonPendingStageTransition[],
) {
  const latest = pendingStageTransitions.at(-1);
  return latest
    ? {
        ...server,
        flowStage: latest.toStage,
        currentChapterId: latest.toChapterId,
      }
    : server;
}

export async function acknowledgeLessonStageTransition(
  draftId: string,
  transition: LessonPendingStageTransition,
  attempt: LessonAttempt,
  database: AltrasDatabase = db,
): Promise<LessonDraft | null> {
  return database.transaction('rw', database.lessonDrafts, async () => {
    const stored = await database.lessonDrafts.get(draftId);
    if (!stored) return null;
    const current = normalizeLessonDraft(stored);
    const first = current.pendingStageTransitions[0];
    if (!first || first.sequence !== transition.sequence || attempt.id !== current.attemptId) {
      return null;
    }
    const serverPosition = lessonFlowPosition(
      current.lesson,
      attempt.flowStage,
      attempt.currentChapterId,
    );
    const pendingStageTransitions = current.pendingStageTransitions.filter(
      (item) => lessonFlowPosition(current.lesson, item.toStage, item.toChapterId) > serverPosition,
    );
    if (pendingStageTransitions.length === current.pendingStageTransitions.length) return null;
    const next: LessonDraft = {
      ...current,
      attempt: reconciledAttempt(attempt, pendingStageTransitions),
      pendingStageTransitions,
      revision: current.revision + 1,
      updatedAt: Date.now(),
      syncStatus: current.pendingCompletion
        ? 'pending_completion'
        : current.pendingAnswers.length > 0 ||
            current.pendingActiveTimeSegments.length > 0 ||
            pendingStageTransitions.length > 0
          ? 'pending'
          : 'synced',
    };
    validateLessonDraft(next);
    await database.lessonDrafts.put(next);
    return next;
  });
}

function isEquivalentLessonDraft(left: LessonDraft, right: LessonDraft): boolean {
  return JSON.stringify({ ...left, updatedAt: 0 }) === JSON.stringify({ ...right, updatedAt: 0 });
}

export async function saveLessonDraft(
  draft: LessonDraft,
  database: AltrasDatabase = db,
): Promise<void> {
  const normalized = normalizeLessonDraft(draft);
  validateLessonDraft(normalized);
  await database.transaction('rw', database.lessonDrafts, async () => {
    const stored = await database.lessonDrafts.get(normalized.id);
    const previous = stored ? normalizeLessonDraft(stored) : undefined;
    if (previous?.revision === normalized.revision && isEquivalentLessonDraft(previous, normalized))
      return;
    if (previous && previous.revision >= normalized.revision) {
      throw new Error('A newer local lesson update is already saved.');
    }
    await database.lessonDrafts.put(normalized);
  });
}

export async function getLessonDraft(
  userId: string,
  lessonId: string,
  attemptId: string,
  database: AltrasDatabase = db,
): Promise<LessonDraft | null> {
  const stored =
    (await database.lessonDrafts.get(lessonDraftId(userId, lessonId, attemptId))) ?? null;
  const draft = stored ? normalizeLessonDraft(stored) : null;
  if (draft) validateLessonDraft(draft);
  return draft;
}

export async function getCachedLessonAssessmentQuestions(
  userId: string,
  lessonId: string,
  attemptId: string,
  kind: AssessmentKind,
  database: AltrasDatabase = db,
): Promise<AssessmentQuestion[]> {
  return (
    (await getLessonDraft(userId, lessonId, attemptId, database))?.assessmentQuestions[kind] ?? []
  );
}

export interface LessonDraftDiscovery {
  drafts: LessonDraft[];
  invalidDraftIds: string[];
}

export async function discoverPendingLessonDrafts(
  userId: string,
  database: AltrasDatabase = db,
): Promise<LessonDraftDiscovery> {
  const stored = await database.lessonDrafts.where('userId').equals(userId).toArray();
  const drafts: LessonDraft[] = [];
  const invalidDraftIds: string[] = [];
  for (const item of stored) {
    try {
      const draft = normalizeLessonDraft(item);
      validateLessonDraft(draft);
      if (
        draft.pendingAnswers.length > 0 ||
        draft.pendingActiveTimeSegments.length > 0 ||
        draft.pendingStageTransitions.length > 0 ||
        draft.pendingCompletion
      ) {
        drafts.push(draft);
      }
    } catch {
      invalidDraftIds.push(item.id);
    }
  }
  return { drafts, invalidDraftIds };
}

export async function getPendingLessonDrafts(
  userId: string,
  database: AltrasDatabase = db,
): Promise<LessonDraft[]> {
  return (await discoverPendingLessonDrafts(userId, database)).drafts;
}

export async function queueLessonActiveTime(
  draftId: string,
  seconds: number,
  database: AltrasDatabase = db,
  segmentId = crypto.randomUUID(),
  now = Date.now(),
): Promise<LessonDraft | null> {
  const duration = Math.min(3600, Math.floor(seconds));
  if (duration <= 0) return null;
  return database.transaction('rw', database.lessonDrafts, async () => {
    const stored = await database.lessonDrafts.get(draftId);
    if (!stored) return null;
    const current = normalizeLessonDraft(stored);
    validateLessonDraft(current);
    if (current.pendingActiveTimeSegments.some((segment) => segment.id === segmentId)) {
      return current;
    }
    const next: LessonDraft = {
      ...current,
      pendingActiveTimeSegments: [
        ...current.pendingActiveTimeSegments,
        { id: segmentId, seconds: duration, queuedAt: now },
      ],
      revision: current.revision + 1,
      updatedAt: now,
      syncStatus: current.pendingCompletion ? 'pending_completion' : 'pending',
    };
    validateLessonDraft(next);
    await database.lessonDrafts.put(next);
    return next;
  });
}

export async function acknowledgeLessonActiveTime(
  draftId: string,
  segmentId: string,
  database: AltrasDatabase = db,
): Promise<LessonDraft | null> {
  return database.transaction('rw', database.lessonDrafts, async () => {
    const stored = await database.lessonDrafts.get(draftId);
    if (!stored) return null;
    const current = normalizeLessonDraft(stored);
    const first = current.pendingActiveTimeSegments[0];
    if (!first || first.id !== segmentId) return null;
    const pendingActiveTimeSegments = current.pendingActiveTimeSegments.slice(1);
    const next: LessonDraft = {
      ...current,
      pendingActiveTimeSegments,
      revision: current.revision + 1,
      updatedAt: Date.now(),
      syncStatus: current.pendingCompletion
        ? 'pending_completion'
        : current.pendingAnswers.length > 0 ||
            current.pendingStageTransitions.length > 0 ||
            pendingActiveTimeSegments.length > 0
          ? 'pending'
          : 'synced',
    };
    await database.lessonDrafts.put(next);
    return next;
  });
}

export async function acknowledgeLessonAnswer(
  draftId: string,
  answer: LessonPendingAnswer,
  attempt: LessonAttempt,
  database: AltrasDatabase = db,
  releasedLesson?: LearningLesson,
): Promise<LessonDraft | null> {
  return database.transaction('rw', database.lessonDrafts, async () => {
    const stored = await database.lessonDrafts.get(draftId);
    if (!stored) return null;
    const current = normalizeLessonDraft(stored);
    const first = current.pendingAnswers[0];
    if (!first || first.activityId !== answer.activityId || attempt.id !== current.attemptId) {
      return null;
    }
    const pendingAnswers = current.pendingAnswers.slice(1);
    if (
      releasedLesson &&
      (releasedLesson.id !== current.lessonId || releasedLesson.contentVersion !== current.contentVersion)
    ) {
      throw new Error('Released activity feedback does not match this lesson attempt.');
    }
    const next: LessonDraft = {
      ...current,
      ...(releasedLesson ? { lesson: releasedLesson } : {}),
      attempt: reconciledAttempt(attempt, current.pendingStageTransitions),
      pendingAnswers,
      revision: current.revision + 1,
      updatedAt: Date.now(),
      syncStatus: current.pendingCompletion
        ? 'pending_completion'
        : pendingAnswers.length > 0 ||
            current.pendingStageTransitions.length > 0 ||
            current.pendingActiveTimeSegments.length > 0
          ? 'pending'
          : 'synced',
    };
    await database.lessonDrafts.put(next);
    return next;
  });
}

export async function deleteLessonDraft(
  draftId: string,
  database: AltrasDatabase = db,
): Promise<void> {
  await database.lessonDrafts.delete(draftId);
}

export async function getUserLessonDrafts(userId: string, database: AltrasDatabase = db) {
  const stored = await database.lessonDrafts.where('userId').equals(userId).toArray();
  return stored.flatMap((item) => {
    try {
      const draft = normalizeLessonDraft(item);
      validateLessonDraft(draft);
      return [draft];
    } catch {
      // Discovery reports invalid drafts separately; keep them available for recovery.
      return [];
    }
  });
}

export async function acknowledgeLessonCompletion(
  snapshot: LessonDraft,
  attempt: LessonAttempt,
  database: AltrasDatabase = db,
): Promise<void> {
  if (
    attempt.id !== snapshot.attemptId ||
    attempt.userId !== snapshot.userId ||
    attempt.lessonId !== snapshot.lessonId ||
    attempt.status !== 'completed' ||
    attempt.finalScore === null ||
    attempt.starCount === null ||
    attempt.cleared === null
  ) {
    throw new Error('The official lesson result is not confirmed.');
  }
  await updateStoredLessonDraft(
    snapshot.id,
    (current) => {
      if (
        current.pendingAnswers.length ||
        current.pendingStageTransitions.length ||
        current.pendingActiveTimeSegments.length
      ) {
        throw new Error('Lesson work is still pending.');
      }
      return {
        ...current,
        attempt,
        pendingCompletion: false,
        syncStatus: 'synced',
        revision: current.revision + 1,
        updatedAt: Date.now(),
      };
    },
    database,
  );
}

interface LessonDraftSynchronizerOptions {
  isCurrent?: () => boolean;
  attemptId?: string;
  load: () => Promise<LessonDraft | null>;
  recordActiveTime: (draft: LessonDraft, segment: LessonPendingActiveTimeSegment) => Promise<void>;
  acknowledgeActiveTime: (
    draft: LessonDraft,
    segment: LessonPendingActiveTimeSegment,
  ) => Promise<void>;
  advanceStage?: (
    draft: LessonDraft,
    transition: LessonPendingStageTransition,
  ) => Promise<LessonAttempt>;
  acknowledgeStage?: (
    draft: LessonDraft,
    transition: LessonPendingStageTransition,
    attempt: LessonAttempt,
  ) => Promise<void>;
  submit: (draft: LessonDraft, answer: LessonPendingAnswer) => Promise<LessonAttempt>;
  acknowledge: (
    draft: LessonDraft,
    answer: LessonPendingAnswer,
    attempt: LessonAttempt,
  ) => Promise<void>;
  complete: (draft: LessonDraft) => Promise<LessonAttempt>;
  onCompleted: (draft: LessonDraft, attempt: LessonAttempt) => Promise<void>;
  onStatus?: (status: 'syncing' | 'synced' | 'pending', error?: unknown) => void;
  retryDelays?: readonly number[];
}

const lessonSyncLocks = new Map<string, Promise<void>>();

export class LessonDraftSynchronizer {
  private running: Promise<void> | null = null;
  private requested = false;
  private stopped = false;
  private get disposed() {
    return this.stopped || this.options.isCurrent?.() === false;
  }
  private retryIndex = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: LessonDraftSynchronizerOptions) {}

  requestSync(resetRetryBurst = true): void {
    if (this.disposed) return;
    this.clearRetry();
    if (resetRetryBurst) this.retryIndex = 0;
    this.requested = true;
    if (!this.running) {
      this.running = Promise.resolve()
        .then(() => this.runExclusive())
        .finally(() => {
          this.running = null;
          if (this.requested && !this.disposed) this.requestSync(false);
        });
    }
  }

  private async runExclusive(): Promise<void> {
    const key = this.options.attemptId;
    if (!key) return this.drain();
    const previous = lessonSyncLocks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.drain());
    lessonSyncLocks.set(key, current);
    try {
      await current;
    } finally {
      if (lessonSyncLocks.get(key) === current) lessonSyncLocks.delete(key);
    }
  }

  async flush(): Promise<void> {
    this.requestSync();
    while (this.running) await this.running;
  }

  dispose(): void {
    this.stopped = true;
    this.requested = false;
    this.clearRetry();
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private async drain(): Promise<void> {
    let visibleWork = false;
    while (this.requested && !this.disposed) {
      this.requested = false;
      let currentHasVisibleWork = false;
      try {
        const snapshot = await this.options.load();
        if (!snapshot || this.disposed) return;
        if (!navigator.onLine || document.visibilityState === 'hidden') {
          if (snapshot.syncStatus !== 'synced') this.options.onStatus?.('pending');
          return;
        }
        currentHasVisibleWork =
          snapshot.pendingAnswers.length > 0 ||
          snapshot.pendingStageTransitions.length > 0 ||
          snapshot.pendingCompletion;
        const answer = snapshot.pendingAnswers[0];
        const transition = snapshot.pendingStageTransitions[0];
        const transitionFirst =
          transition &&
          (!answer || (answer.sequence !== undefined && transition.sequence < answer.sequence));
        if (transitionFirst) {
          visibleWork = true;
          this.options.onStatus?.('syncing');
          if (!this.options.advanceStage || !this.options.acknowledgeStage) {
            throw new Error('Lesson stage synchronization is unavailable.');
          }
          const attempt = await this.options.advanceStage(snapshot, transition);
          if (this.disposed) return;
          await this.options.acknowledgeStage(snapshot, transition, attempt);
          this.retryIndex = 0;
          this.requested = true;
          continue;
        }
        if (answer) {
          visibleWork = true;
          this.options.onStatus?.('syncing');
          const attempt = await this.options.submit(snapshot, answer);
          if (this.disposed) return;
          await this.options.acknowledge(snapshot, answer, attempt);
          this.retryIndex = 0;
          this.requested = true;
          continue;
        }
        const activeTime = snapshot.pendingActiveTimeSegments[0];
        if (activeTime) {
          await this.options.recordActiveTime(snapshot, activeTime);
          if (this.disposed) return;
          await this.options.acknowledgeActiveTime(snapshot, activeTime);
          this.retryIndex = 0;
          this.requested = true;
          continue;
        }
        if (snapshot.pendingCompletion) {
          visibleWork = true;
          this.options.onStatus?.('syncing');
          const completed = await this.options.complete(snapshot);
          if (this.disposed) return;
          await this.options.onCompleted(snapshot, completed);
          this.retryIndex = 0;
          return;
        }
        this.retryIndex = 0;
        if (visibleWork) this.options.onStatus?.('synced');
      } catch (error) {
        if (this.disposed) return;
        if (visibleWork || currentHasVisibleWork) this.options.onStatus?.('pending', error);
        this.requested = false;
        this.scheduleRetry();
      }
    }
  }

  private scheduleRetry(): void {
    this.clearRetry();
    const delays = this.options.retryDelays ?? LESSON_SYNC_RETRY_DELAYS;
    if (
      delays.length === 0 ||
      this.disposed ||
      (typeof navigator !== 'undefined' && !navigator.onLine) ||
      (typeof document !== 'undefined' && document.visibilityState === 'hidden')
    )
      return;
    const delay = delays[this.retryIndex++] ?? 60_000;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.requestSync(false);
    }, delay);
  }
}
