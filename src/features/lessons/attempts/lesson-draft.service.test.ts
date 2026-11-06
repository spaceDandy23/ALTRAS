import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AltrasDatabase } from '@/db/database';
import { packagedContent } from '../content/packaged-content';
import { activitySchema, publicActivitySchema } from '../domain/content.schemas';
import type { LessonAttempt } from '@/types/learning';
import {
  LessonDraftSynchronizer,
  acknowledgeLessonActiveTime,
  acknowledgeLessonAnswer,
  acknowledgeLessonStageTransition,
  createLessonDraft,
  discoverPendingLessonDrafts,
  getLessonDraft,
  lessonDraftId,
  markLessonDraftPendingCompletion,
  queueLessonAnswer,
  queueLessonActiveTime,
  queueLessonStageTransition,
  reconcileLessonDraft,
  saveLessonDraft,
  updateStoredLessonDraft,
  updateLessonDraftPosition,
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

  it('persists a queued translation choice and restores it after reopening the app database', async () => {
    const name = `lesson-translation-resume-${crypto.randomUUID()}`;
    const first = new AltrasDatabase(name);
    const privateActivity = activitySchema.parse({
      id: 'translate-resume',
      type: 'choose-correct-translation',
      title: 'Choose the expression',
      prompt: 'The sum of a number and five',
      choices: [
        { id: 'answer-key-id', label: 'n + 5' },
        { id: 'wrong-option-id', label: 'n - 5' },
      ],
      correctChoiceId: 'answer-key-id',
      explanation: { title: 'Sum', body: 'Sum means addition.' },
    });
    if (privateActivity.type !== 'choose-correct-translation') throw new Error('Invalid test activity.');
    const { correctChoiceId: _correctChoiceId, ...publicFields } = privateActivity;
    expect(_correctChoiceId).toBe('answer-key-id');
    const offlineLesson = {
      ...structuredClone(lesson),
      activities: [publicActivitySchema.parse(publicFields)],
    };
    const initial = createLessonDraft(attempt(), offlineLesson);
    await saveLessonDraft(
      queueLessonAnswer(
        initial,
        privateActivity.id,
        privateActivity.type,
        'answer-key-id',
        0,
        100,
      ),
      first,
    );
    first.close();

    const restoredDatabase = new AltrasDatabase(name);
    databases.push(restoredDatabase);
    await expect(
      getLessonDraft(userId, lesson.id, attemptId, restoredDatabase),
    ).resolves.toMatchObject({
      pendingAnswers: [
        {
          activityId: 'translate-resume',
          activityType: 'choose-correct-translation',
          answer: 'answer-key-id',
        },
      ],
    });
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

  it('persists an offline teaching transition across reload', async () => {
    const name = `lesson-stage-refresh-${crypto.randomUUID()}`;
    const first = new AltrasDatabase(name);
    const chapterLesson = {
      ...structuredClone(lesson),
      chapters: [
        {
          id: 'chapter-one',
          title: 'Chapter one',
          displayOrder: 1,
          instructionalContent: lesson.instructionalContent,
          activities: lesson.activities,
        },
      ],
    };
    const initial = createLessonDraft(
      attempt({ flowStage: 'chapter-teaching', currentChapterId: 'chapter-one' }),
      chapterLesson,
    );
    await saveLessonDraft(initial, first);

    const queued = await queueLessonStageTransition(initial.id, first, 100);
    expect(queued).toMatchObject({
      attempt: { flowStage: 'chapter-activity', currentChapterId: 'chapter-one' },
      pendingStageTransitions: [
        {
          fromStage: 'chapter-teaching',
          fromChapterId: 'chapter-one',
          toStage: 'chapter-activity',
          toChapterId: 'chapter-one',
        },
      ],
    });

    first.close();
    const restored = new AltrasDatabase(name);
    databases.push(restored);
    await expect(getLessonDraft(userId, lesson.id, attemptId, restored)).resolves.toMatchObject({
      attempt: { flowStage: 'chapter-activity' },
      pendingStageTransitions: [{ fromStage: 'chapter-teaching' }],
    });
  });

  it('removes an accepted transition while preserving newer offline work', async () => {
    const local = database();
    const chapterLesson = {
      ...structuredClone(lesson),
      chapters: [
        {
          id: 'chapter-one',
          title: 'Chapter one',
          displayOrder: 1,
          instructionalContent: lesson.instructionalContent,
          activities: lesson.activities,
        },
      ],
    };
    const initial = createLessonDraft(
      attempt({ flowStage: 'chapter-teaching', currentChapterId: 'chapter-one' }),
      chapterLesson,
    );
    await saveLessonDraft(initial, local);
    const queued = await queueLessonStageTransition(initial.id, local, 100);

    const acknowledged = await acknowledgeLessonStageTransition(
      queued.id,
      queued.pendingStageTransitions[0],
      attempt({ flowStage: 'chapter-activity', currentChapterId: 'chapter-one' }),
      local,
    );

    expect(acknowledged).toMatchObject({
      attempt: { flowStage: 'chapter-activity' },
      pendingStageTransitions: [],
      syncStatus: 'synced',
    });
  });

  it('replays offline transitions and answers in their original order', async () => {
    const local = database();
    const activity = lesson.activities[0];
    const chapterLesson = {
      ...structuredClone(lesson),
      chapters: [
        {
          id: 'chapter-one',
          title: 'Chapter one',
          displayOrder: 1,
          instructionalContent: lesson.instructionalContent,
          activities: [activity],
        },
      ],
      activities: [activity],
    };
    const initial = createLessonDraft(
      attempt({
        flowStage: 'chapter-teaching',
        currentChapterId: 'chapter-one',
        postAssessmentVersion: 1,
      }),
      chapterLesson,
    );
    await saveLessonDraft(initial, local);
    const activityStage = await queueLessonStageTransition(initial.id, local, 100);
    const answered = queueLessonAnswer(
      activityStage,
      activity.id,
      activity.type,
      activity.type === 'organize-translate'
        ? activity.tokens.map((token) => token.id)
        : activity.choices[0].id,
      0,
      200,
    );
    await saveLessonDraft(answered, local);
    await queueLessonStageTransition(initial.id, local, 300);
    const events: string[] = [];
    let server = initial.attempt;
    const synchronizer = new LessonDraftSynchronizer({
      load: () => getLessonDraft(userId, lesson.id, attemptId, local),
      recordActiveTime: vi.fn(),
      acknowledgeActiveTime: vi.fn(),
      advanceStage: async (_draft, transition) => {
        events.push(`stage:${transition.fromStage}`);
        server = {
          ...server,
          flowStage: transition.toStage,
          currentChapterId: transition.toChapterId,
        };
        return server;
      },
      acknowledgeStage: (snapshot, transition, next) =>
        acknowledgeLessonStageTransition(snapshot.id, transition, next, local).then(
          () => undefined,
        ),
      submit: async (_draft, pending) => {
        events.push(`answer:${pending.activityId}`);
        server = {
          ...server,
          answers: [
            {
              activityId: pending.activityId,
              activityType: pending.activityType,
              answer: pending.answer,
              isCorrect: true,
              submittedAt: 250,
            },
          ],
        };
        return server;
      },
      acknowledge: (snapshot, pending, next) =>
        acknowledgeLessonAnswer(snapshot.id, pending, next, local).then(() => undefined),
      complete: vi.fn(),
      onCompleted: vi.fn(),
      retryDelays: [],
    });

    await synchronizer.flush();

    expect(events).toEqual([
      'stage:chapter-teaching',
      `answer:${activity.id}`,
      'stage:chapter-activity',
    ]);
    await expect(getLessonDraft(userId, lesson.id, attemptId, local)).resolves.toMatchObject({
      attempt: { flowStage: 'post-test' },
      pendingAnswers: [],
      pendingStageTransitions: [],
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

  it('keeps the newest local position when an earlier activity is acknowledged during navigation', async () => {
    const local = database();
    const initial = queueLessonAnswer(
      createLessonDraft(attempt(), lesson),
      lesson.activities[0].id,
      lesson.activities[0].type,
      'sum',
      0,
    );
    await saveLessonDraft(initial, local);
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
    await Promise.all([
      acknowledgeLessonAnswer(initial.id, initial.pendingAnswers[0], server, local),
      updateStoredLessonDraft(
        initial.id,
        (current) => updateLessonDraftPosition(current, 2),
        local,
      ),
    ]);
    expect(await getLessonDraft(userId, lesson.id, attemptId, local)).toMatchObject({
      currentActivityIndex: 2,
      pendingAnswers: [],
      attempt: { answers: server.answers },
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

  it('reconciles a transition accepted before its response was lost', async () => {
    const local = database();
    const chapterLesson = {
      ...structuredClone(lesson),
      chapters: [
        {
          id: 'chapter-one',
          title: 'Chapter one',
          displayOrder: 1,
          instructionalContent: lesson.instructionalContent,
          activities: lesson.activities,
        },
      ],
    };
    const initial = createLessonDraft(
      attempt({ flowStage: 'chapter-teaching', currentChapterId: 'chapter-one' }),
      chapterLesson,
    );
    await saveLessonDraft(initial, local);
    const queued = await queueLessonStageTransition(initial.id, local, 100);

    expect(
      reconcileLessonDraft(
        attempt({ flowStage: 'chapter-activity', currentChapterId: 'chapter-one' }),
        chapterLesson,
        queued,
      ),
    ).toMatchObject({
      attempt: { flowStage: 'chapter-activity' },
      pendingStageTransitions: [],
      syncStatus: 'synced',
    });
  });

  it('does not restore a stale draft into a fresh retry attempt', async () => {
    const local = database();
    await saveLessonDraft(createLessonDraft(attempt(), lesson), local);
    const retryAttemptId = '50000000-0000-4000-8000-000000000005';

    await expect(getLessonDraft(userId, lesson.id, retryAttemptId, local)).resolves.toBeNull();
  });

  it('keeps pending completion after a failed request and finishes once on a later retry', async () => {
    let current: LessonDraft | null = markLessonDraftPendingCompletion(
      createLessonDraft(
        attempt({
          answers: lesson.activities.map((activity, index) => ({
            activityId: activity.id,
            activityType: activity.type,
            answer:
              activity.type === 'organize-translate'
                ? activity.tokens.map((token) => token.id)
                : activity.choices[0].id,
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

  it('serializes active-page and global workers for the same attempt', async () => {
    let current: LessonDraft | null = queueLessonAnswer(
      createLessonDraft(attempt(), lesson),
      lesson.activities[0].id,
      lesson.activities[0].type,
      'sum',
      1,
    );
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const submit = vi.fn(async () => {
      await gate;
      return attempt({
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
    });
    const createSynchronizer = () =>
      new LessonDraftSynchronizer({
        attemptId,
        load: async () => current,
        recordActiveTime: vi.fn(),
        acknowledgeActiveTime: vi.fn(),
        submit,
        acknowledge: async (_draft, _answer, server) => {
          if (current) current = { ...current, attempt: server, pendingAnswers: [] };
        },
        complete: async () => attempt(),
        onCompleted: async () => undefined,
        retryDelays: [],
      });
    const activeWorker = createSynchronizer();
    const globalWorker = createSynchronizer();

    const activeFlush = activeWorker.flush();
    const globalFlush = globalWorker.flush();
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    finish();
    await Promise.all([activeFlush, globalFlush]);

    expect(submit).toHaveBeenCalledOnce();
    expect(current?.pendingAnswers).toHaveLength(0);
  });

  it('preserves a corrupt lesson draft without blocking valid pending work', async () => {
    const database = new AltrasDatabase(`lesson-discovery-${crypto.randomUUID()}`);
    try {
      const valid = queueLessonAnswer(
        createLessonDraft(attempt(), lesson),
        lesson.activities[0].id,
        lesson.activities[0].type,
        'sum',
        0,
      );
      const invalid = { ...valid, id: 'invalid-lesson-draft' };
      await database.lessonDrafts.bulkPut([valid, invalid]);

      const discovery = await discoverPendingLessonDrafts(userId, database);

      expect(discovery.drafts.map((item) => item.id)).toEqual([valid.id]);
      expect(discovery.invalidDraftIds).toEqual(['invalid-lesson-draft']);
      expect(await database.lessonDrafts.get('invalid-lesson-draft')).toBeDefined();
    } finally {
      await database.delete();
    }
  });
});
