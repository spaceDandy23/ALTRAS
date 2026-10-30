import type { AltrasDatabase } from '@/db/database';
import { db } from '@/db/database';
import type { LessonAttempt } from '@/types/learning';
import type { LearningLesson } from '../domain/content.schemas';
import type { ActivityAnswer } from '../domain/evaluation';

export type LessonDraftSyncStatus = 'synced' | 'pending' | 'pending_completion';

export interface LessonPendingAnswer {
  activityId: string;
  activityType: 'find-word' | 'organize-translate';
  answer: ActivityAnswer;
  queuedAt: number;
}

export interface LessonPendingActiveTimeSegment {
  id: string;
  seconds: number;
  queuedAt: number;
}

export interface LessonDraft {
  id: string;
  userId: string;
  lessonId: string;
  attemptId: string;
  contentVersion: number;
  lesson: LearningLesson;
  attempt: LessonAttempt;
  pendingAnswers: LessonPendingAnswer[];
  pendingActiveTimeSegments: LessonPendingActiveTimeSegment[];
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
  return Array.isArray(draft.pendingActiveTimeSegments)
    ? draft
    : { ...draft, pendingActiveTimeSegments: [] };
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
    new Set(draft.pendingAnswers.map((answer) => answer.activityId)).size !==
      draft.pendingAnswers.length ||
    new Set(draft.pendingActiveTimeSegments.map((segment) => segment.id)).size !==
      draft.pendingActiveTimeSegments.length ||
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
    attempt,
    pendingAnswers: [],
    pendingActiveTimeSegments: [],
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
  validateLessonDraft(local);
  if (
    local.userId !== attempt.userId ||
    local.attemptId !== attempt.id ||
    local.contentVersion !== attempt.contentVersion
  ) {
    throw new Error('The local lesson draft belongs to a different attempt.');
  }
  const confirmed = new Set(attempt.answers.map((answer) => answer.activityId));
  const pendingAnswers = local.pendingAnswers.filter((answer) => !confirmed.has(answer.activityId));
  return {
    ...local,
    lesson,
    attempt,
    pendingAnswers,
    revision: local.revision + 1,
    updatedAt: Date.now(),
    syncStatus: local.pendingCompletion
      ? 'pending_completion'
      : pendingAnswers.length > 0 || local.pendingActiveTimeSegments.length > 0
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
    pendingAnswers: [...draft.pendingAnswers, { activityId, activityType, answer, queuedAt: now }],
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
        : current.pendingAnswers.length > 0 || pendingActiveTimeSegments.length > 0
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
    const next: LessonDraft = {
      ...current,
      attempt,
      pendingAnswers,
      revision: current.revision + 1,
      updatedAt: Date.now(),
      syncStatus: current.pendingCompletion
        ? 'pending_completion'
        : pendingAnswers.length > 0 || current.pendingActiveTimeSegments.length > 0
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

interface LessonDraftSynchronizerOptions {
  load: () => Promise<LessonDraft | null>;
  recordActiveTime: (draft: LessonDraft, segment: LessonPendingActiveTimeSegment) => Promise<void>;
  acknowledgeActiveTime: (
    draft: LessonDraft,
    segment: LessonPendingActiveTimeSegment,
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

export class LessonDraftSynchronizer {
  private running: Promise<void> | null = null;
  private requested = false;
  private disposed = false;
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
        .then(() => this.drain())
        .finally(() => {
          this.running = null;
          if (this.requested && !this.disposed) this.requestSync(false);
        });
    }
  }

  async flush(): Promise<void> {
    this.requestSync();
    while (this.running) await this.running;
  }

  dispose(): void {
    this.disposed = true;
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
        currentHasVisibleWork = snapshot.pendingAnswers.length > 0 || snapshot.pendingCompletion;
        const answer = snapshot.pendingAnswers[0];
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
    const delay = delays[this.retryIndex++];
    if (delay === undefined || this.disposed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.requestSync(false);
    }, delay);
  }
}
