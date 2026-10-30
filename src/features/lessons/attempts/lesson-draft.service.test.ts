import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AltrasDatabase } from '@/db/database';
import { packagedContent } from '../content/packaged-content';
import type { LessonAttempt } from '@/types/learning';
import {
  LessonDraftSynchronizer,
  acknowledgeLessonActiveTime,
  acknowledgeLessonAnswer,
  createLessonDraft,
  getLessonDraft,
  lessonDraftId,
  markLessonDraftPendingCompletion,
  queueLessonAnswer,
  queueLessonActiveTime,
  reconcileLessonDraft,
  saveLessonDraft,
  type LessonDraft,
} from './lesson-draft.service';

const userId = '20000000-0000-4000-8000-000000000002';
const attemptId = '10000000-0000-4000-8000-000000000001';
const lesson = packagedContent.lessons[0];

function attempt(overrides: Partial<LessonAttempt> = {}): LessonAttempt {
  return {
    id: attemptId,
    userId,
    lessonId: lesson.id,
    contentVersion: lesson.contentVersion,
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
    ...overrides,
  };
}

describe('offline lesson drafts', () => {
  const databases: AltrasDatabase[] = [];
  afterEach(async () => {
    for (const database of databases) {
      database.close();
      await database.delete();
    }
    databases.length = 0;
  });

  function database() {
    const value = new AltrasDatabase(`lesson-draft-${crypto.randomUUID()}`);
    databases.push(value);
    return value;
  }

  it('durably stores an offline answer and restores its activity position for only its owner', async () => {
    const local = database();
    const draft = queueLessonAnswer(
      createLessonDraft(attempt(), lesson),
      lesson.activities[0].id,
      lesson.activities[0].type,
      'sum',
      1,
    );

    await saveLessonDraft(draft, local);

    await expect(getLessonDraft(userId, lesson.id, attemptId, local)).resolves.toMatchObject({
      currentActivityIndex: 1,
      pendingAnswers: [{ activityId: lesson.activities[0].id, answer: 'sum' }],
    });
    await expect(
      getLessonDraft('30000000-0000-4000-8000-000000000003', lesson.id, attemptId, local),
    ).resolves.toBeNull();
  });

  it('persists pending active time across a refresh', async () => {
    const name = `lesson-time-refresh-${crypto.randomUUID()}`;
    const first = new AltrasDatabase(name);
    await saveLessonDraft(createLessonDraft(attempt(), lesson), first);
    const segmentId = crypto.randomUUID();

    await queueLessonActiveTime(
      lessonDraftId(userId, lesson.id, attemptId),
      30,
      first,
      segmentId,
      100,
    );
    first.close();
    const restored = new AltrasDatabase(name);
    databases.push(restored);

    await expect(getLessonDraft(userId, lesson.id, attemptId, restored)).resolves.toMatchObject({
      pendingActiveTimeSegments: [{ id: segmentId, seconds: 30, queuedAt: 100 }],
    });
  });

  it('retains a failed active-time write for reconnect replay', async () => {
    const local = database();
    const initial = createLessonDraft(attempt(), lesson);
    await saveLessonDraft(initial, local);
    const segmentId = crypto.randomUUID();
    await queueLessonActiveTime(initial.id, 18, local, segmentId, 100);
    const recordActiveTime = vi.fn().mockRejectedValue(new Error('offline'));
    const synchronizer = new LessonDraftSynchronizer({
      load: () => getLessonDraft(userId, lesson.id, attemptId, local),
      recordActiveTime,
      acknowledgeActiveTime: (snapshot, segment) =>
        acknowledgeLessonActiveTime(snapshot.id, segment.id, local).then(() => undefined),
      submit: vi.fn(),
      acknowledge: vi.fn(),
      complete: vi.fn(),
      onCompleted: vi.fn(),
      retryDelays: [],
    });

    await synchronizer.flush();

    expect(recordActiveTime).toHaveBeenCalledOnce();
    await expect(getLessonDraft(userId, lesson.id, attemptId, local)).resolves.toMatchObject({
      pendingActiveTimeSegments: [{ id: segmentId, seconds: 18 }],
    });
  });

  it('replays the same active-time segment idempotently after a lost response', async () => {
    const local = database();
    const initial = createLessonDraft(attempt(), lesson);
    await saveLessonDraft(initial, local);
    const segmentId = crypto.randomUUID();
    await queueLessonActiveTime(initial.id, 24, local, segmentId, 100);
    const accepted = new Set<string>();
    let recordedSeconds = 0;
    const recordActiveTime = vi.fn(
      async (_draft: LessonDraft, segment: { id: string; seconds: number }) => {
        if (!accepted.has(segment.id)) {
          accepted.add(segment.id);
          recordedSeconds += segment.seconds;
          throw new Error('response lost');
        }
      },
    );
    const synchronizer = new LessonDraftSynchronizer({
      load: () => getLessonDraft(userId, lesson.id, attemptId, local),
      recordActiveTime,
      acknowledgeActiveTime: (snapshot, segment) =>
        acknowledgeLessonActiveTime(snapshot.id, segment.id, local).then(() => undefined),
      submit: vi.fn(),
      acknowledge: vi.fn(),
      complete: vi.fn(),
      onCompleted: vi.fn(),
      retryDelays: [],
    });

    await synchronizer.flush();
    await synchronizer.flush();

    expect(recordActiveTime).toHaveBeenCalledTimes(2);
    expect(recordActiveTime.mock.calls.map(([, segment]) => segment.id)).toEqual([
      segmentId,
      segmentId,
    ]);
    expect(recordedSeconds).toBe(24);
    await expect(getLessonDraft(userId, lesson.id, attemptId, local)).resolves.toMatchObject({
      pendingActiveTimeSegments: [],
    });
  });

  it('propagates local persistence failure so the player cannot advance unsafely', async () => {
    const local = database();
    vi.spyOn(local.lessonDrafts, 'put').mockRejectedValue(new Error('quota'));

    await expect(saveLessonDraft(createLessonDraft(attempt(), lesson), local)).rejects.toThrow(
      'quota',
    );
  });

  it('treats an equivalent same-revision restore as an idempotent save', async () => {
    const local = database();
    const first = createLessonDraft(attempt(), lesson);
    const duplicate = { ...first, updatedAt: first.updatedAt + 1 };

    await saveLessonDraft(first, local);

    await expect(saveLessonDraft(duplicate, local)).resolves.toBeUndefined();
    await expect(getLessonDraft(userId, lesson.id, attemptId, local)).resolves.toEqual(first);
  });

  it('still rejects conflicting state at the same revision', async () => {
    const local = database();
    const first = createLessonDraft(attempt(), lesson);
    const conflicting = { ...first, currentActivityIndex: 1 };

    await saveLessonDraft(first, local);

    await expect(saveLessonDraft(conflicting, local)).rejects.toThrow(
      'A newer local lesson update is already saved.',
    );
  });

  it('does not let an out-of-order acknowledgement remove newer queued state', async () => {
    const local = database();
    const first = queueLessonAnswer(
      createLessonDraft(attempt(), lesson),
      lesson.activities[0].id,
      lesson.activities[0].type,
      'sum',
      1,
    );
    const queued = queueLessonAnswer(
      first,
      lesson.activities[1].id,
      lesson.activities[1].type,
      'product',
      2,
    );
    await saveLessonDraft(queued, local);

    await expect(
      acknowledgeLessonAnswer(queued.id, queued.pendingAnswers[1], attempt(), local),
    ).resolves.toBeNull();
    await expect(getLessonDraft(userId, lesson.id, attemptId, local)).resolves.toMatchObject({
      pendingAnswers: [
        { activityId: lesson.activities[0].id },
        { activityId: lesson.activities[1].id },
      ],
    });
  });

  it('synchronizes queued answers in order and completes only after every answer is acknowledged', async () => {
    let current: LessonDraft | null = markLessonDraftPendingCompletion(
      queueLessonAnswer(
        queueLessonAnswer(
          createLessonDraft(attempt(), lesson),
          lesson.activities[0].id,
          lesson.activities[0].type,
          'sum',
          1,
        ),
        lesson.activities[1].id,
        lesson.activities[1].type,
        'product',
        2,
      ),
    );
    const events: string[] = [];
    const synchronizer = new LessonDraftSynchronizer({
      load: async () => current,
      recordActiveTime: vi.fn(),
      acknowledgeActiveTime: vi.fn(),
      submit: async (_draft, answer) => {
        events.push(`answer:${answer.activityId}`);
        return attempt({
          answers: [
            ...(current?.attempt.answers ?? []),
            {
              activityId: answer.activityId,
              activityType: answer.activityType,
              answer: answer.answer,
              isCorrect: true,
              submittedAt: Date.now(),
            },
          ],
        });
      },
      acknowledge: async (_snapshot, answer, server) => {
        if (!current) return;
        current = {
          ...current,
          attempt: server,
          pendingAnswers: current.pendingAnswers.filter(
            (pending) => pending.activityId !== answer.activityId,
          ),
        };
      },
      complete: async () => {
        events.push('complete');
        return attempt({ status: 'completed', completedAt: 10, finalScore: 100, starCount: 3 });
      },
      onCompleted: async () => {
        events.push('result');
        current = null;
      },
      retryDelays: [],
    });

    await synchronizer.flush();

    expect(events).toEqual([
      `answer:${lesson.activities[0].id}`,
      `answer:${lesson.activities[1].id}`,
      'complete',
      'result',
    ]);
    expect(current).toBeNull();
  });

  it('coalesces duplicate reconnect requests and retains a failed answer for a later retry', async () => {
    let current: LessonDraft | null = queueLessonAnswer(
      createLessonDraft(attempt(), lesson),
      lesson.activities[0].id,
      lesson.activities[0].type,
      'sum',
      1,
    );
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(
        attempt({
          answers: [
            {
              activityId: lesson.activities[0].id,
              activityType: lesson.activities[0].type,
              answer: 'sum',
              isCorrect: true,
              submittedAt: 2,
            },
          ],
        }),
      );
    const synchronizer = new LessonDraftSynchronizer({
      load: async () => current,
      recordActiveTime: vi.fn(),
      acknowledgeActiveTime: vi.fn(),
      submit,
      acknowledge: async (_snapshot, answer, server) => {
        if (!current) return;
        current = { ...current, attempt: server, pendingAnswers: [] };
        expect(answer.activityId).toBe(lesson.activities[0].id);
      },
      complete: async () => attempt(),
      onCompleted: async () => undefined,
      retryDelays: [],
    });

    synchronizer.requestSync();
    synchronizer.requestSync();
    await synchronizer.flush();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(current?.pendingAnswers).toHaveLength(1);

    await synchronizer.flush();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(current?.pendingAnswers).toHaveLength(0);
  });

  it('acknowledges a lost answer response from authoritative attempt state without queuing it twice', () => {
    const queued = queueLessonAnswer(
      createLessonDraft(attempt(), lesson),
      lesson.activities[0].id,
      lesson.activities[0].type,
      'sum',
      1,
    );
    const server = attempt({
      answers: [
        {
          activityId: lesson.activities[0].id,
          activityType: lesson.activities[0].type,
          answer: 'sum',
          isCorrect: true,
          submittedAt: 2,
        },
      ],
    });

    expect(reconcileLessonDraft(server, lesson, queued)).toMatchObject({
      pendingAnswers: [],
      attempt: { answers: [{ activityId: lesson.activities[0].id }] },
      syncStatus: 'synced',
    });
  });

  it('keeps pending completion after a failed request and finishes once on a later retry', async () => {
    let current: LessonDraft | null = markLessonDraftPendingCompletion(
      createLessonDraft(
        attempt({
          answers: lesson.activities.map((activity, index) => ({
            activityId: activity.id,
            activityType: activity.type,
            answer:
              activity.type === 'find-word'
                ? activity.choices[0].id
                : activity.tokens.map((token) => token.id),
            isCorrect: false,
            submittedAt: index + 1,
          })),
        }),
        lesson,
      ),
    );
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce(
        attempt({ status: 'completed', completedAt: 20, finalScore: 80, starCount: 1 }),
      );
    const onCompleted = vi.fn(async () => {
      current = null;
    });
    const synchronizer = new LessonDraftSynchronizer({
      load: async () => current,
      recordActiveTime: vi.fn(),
      acknowledgeActiveTime: vi.fn(),
      submit: vi.fn(),
      acknowledge: vi.fn(),
      complete,
      onCompleted,
      retryDelays: [],
    });

    await synchronizer.flush();
    expect(current?.pendingCompletion).toBe(true);
    expect(onCompleted).not.toHaveBeenCalled();
    await synchronizer.flush();

    expect(complete).toHaveBeenCalledTimes(2);
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(current).toBeNull();
  });
});
