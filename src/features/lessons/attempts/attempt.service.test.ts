import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AltrasDatabase } from '@/db/database';
import { registerUser } from '@/features/auth/auth.service';
import { initializePackagedContent, getLesson } from '../content/content.service';
import {
  completeAttempt,
  getActiveAttempt,
  restartAttempt,
  startOrResumeAttempt,
  submitActivityAnswer,
} from './attempt.service';
import { ensureUserLessonProgress, getLessonProgress } from '../progress/progress.service';
import type { LessonActivity } from '../domain/content.schemas';

function answerFor(activity: LessonActivity, correct: boolean): string | string[] {
  if (activity.type === 'find-word') {
    return correct
      ? activity.correctChoiceId
      : (activity.choices.find((choice) => choice.id !== activity.correctChoiceId)?.id ?? 'wrong');
  }
  return correct
    ? activity.correctTokenSequence
    : [...activity.correctTokenSequence.slice(1), activity.correctTokenSequence[0]];
}

async function answerAndComplete(
  database: AltrasDatabase,
  userId: string,
  correctCount: number,
  lessonId = 'lesson-operation-signals',
) {
  const lesson = await getLesson(database, lessonId);
  const attempt = await startOrResumeAttempt(database, userId, lesson.id);
  for (const [index, activity] of lesson.activities.entries()) {
    await submitActivityAnswer(
      database,
      attempt.id,
      activity.id,
      answerFor(activity, index < correctCount),
    );
  }
  return completeAttempt(database, attempt.id);
}

describe('attempt persistence and lesson progression', () => {
  let database: AltrasDatabase;
  let firstUserId: string;
  let secondUserId: string;

  beforeEach(async () => {
    database = new AltrasDatabase(`altras-attempt-${crypto.randomUUID()}`);
    await initializePackagedContent(database);
    firstUserId = (
      await registerUser(database, {
        username: 'first_solver',
        displayName: 'First Solver',
        password: 'Lesson123',
        confirmPassword: 'Lesson123',
      })
    ).id;
    secondUserId = (
      await registerUser(database, {
        username: 'second_solver',
        displayName: 'Second Solver',
        password: 'Lesson456',
        confirmPassword: 'Lesson456',
      })
    ).id;
    await ensureUserLessonProgress(database, firstUserId);
    await ensureUserLessonProgress(database, secondUserId);
  });

  afterEach(async () => database.delete());

  it('starts the first lesson available and its prerequisite follow-up locked per user', async () => {
    await expect(
      getLessonProgress(database, firstUserId, 'lesson-operation-signals'),
    ).resolves.toMatchObject({ status: 'available' });
    await expect(
      getLessonProgress(database, firstUserId, 'lesson-order-matters'),
    ).resolves.toMatchObject({ status: 'locked' });
    await expect(
      getLessonProgress(database, secondUserId, 'lesson-order-matters'),
    ).resolves.toMatchObject({ status: 'locked' });
  });

  it('persists and resumes one active attempt, then restarts without deleting it', async () => {
    const lesson = await getLesson(database, 'lesson-operation-signals');
    const started = await startOrResumeAttempt(database, firstUserId, lesson.id);
    await submitActivityAnswer(
      database,
      started.id,
      lesson.activities[0].id,
      answerFor(lesson.activities[0], true),
    );

    const resumed = await startOrResumeAttempt(database, firstUserId, lesson.id);
    expect(resumed.id).toBe(started.id);
    expect(resumed.answers).toHaveLength(1);

    const restarted = await restartAttempt(database, firstUserId, lesson.id);
    expect(restarted.id).not.toBe(started.id);
    expect(restarted.answers).toHaveLength(0);
    await expect(database.lessonAttempts.get(started.id)).resolves.toMatchObject({
      status: 'abandoned',
    });
    await expect(getActiveAttempt(database, firstUserId, lesson.id)).resolves.toMatchObject({
      id: restarted.id,
    });
  });

  it('keeps a failed attempt, does not unlock, then unlocks after a passing retry', async () => {
    const failed = await answerAndComplete(database, firstUserId, 4);
    expect(failed.finalScore).toBe(67);
    expect(failed.cleared).toBe(false);
    await expect(
      getLessonProgress(database, firstUserId, 'lesson-order-matters'),
    ).resolves.toMatchObject({ status: 'locked' });

    const passed = await answerAndComplete(database, firstUserId, 5);
    expect(passed.finalScore).toBe(83);
    expect(passed.starCount).toBe(1);
    expect(passed.cleared).toBe(true);
    await expect(
      getLessonProgress(database, firstUserId, 'lesson-order-matters'),
    ).resolves.toMatchObject({ status: 'available' });
    await expect(
      getLessonProgress(database, secondUserId, 'lesson-order-matters'),
    ).resolves.toMatchObject({ status: 'locked' });
  });

  it('does not decrease best results or farm XP, and completion is idempotent', async () => {
    const perfect = await answerAndComplete(database, firstUserId, 6);
    expect(perfect.finalScore).toBe(100);
    expect(perfect.starCount).toBe(3);
    expect(perfect.xpImprovement).toBe(130);

    await completeAttempt(database, perfect.id);
    await expect(
      getLessonProgress(database, firstUserId, 'lesson-operation-signals'),
    ).resolves.toMatchObject({ attemptCount: 1 });

    const lower = await answerAndComplete(database, firstUserId, 5);
    expect(lower.xpImprovement).toBe(0);
    await expect(
      getLessonProgress(database, firstUserId, 'lesson-operation-signals'),
    ).resolves.toMatchObject({
      bestScore: 100,
      bestStarCount: 3,
      xpAwarded: 130,
      attemptCount: 2,
    });
  });

  it('records only the first submitted answer for an activity', async () => {
    const lesson = await getLesson(database, 'lesson-operation-signals');
    const activity = lesson.activities[0];
    const attempt = await startOrResumeAttempt(database, firstUserId, lesson.id);
    await submitActivityAnswer(database, attempt.id, activity.id, answerFor(activity, false));
    const repeated = await submitActivityAnswer(
      database,
      attempt.id,
      activity.id,
      answerFor(activity, true),
    );

    expect(repeated.answers).toHaveLength(1);
    expect(repeated.answers[0].isCorrect).toBe(false);
  });

  it('persists and resumes an Order Matters attempt after Lesson 1 is cleared', async () => {
    await answerAndComplete(database, firstUserId, 5);
    const lesson = await getLesson(database, 'lesson-order-matters');
    const started = await startOrResumeAttempt(database, firstUserId, lesson.id);
    await submitActivityAnswer(
      database,
      started.id,
      lesson.activities[0].id,
      answerFor(lesson.activities[0], true),
    );

    const resumed = await startOrResumeAttempt(database, firstUserId, lesson.id);

    expect(resumed.id).toBe(started.id);
    expect(resumed.contentVersion).toBe(2);
    expect(resumed.answers).toHaveLength(1);
    await expect(database.lessonAttempts.get(started.id)).resolves.toMatchObject({
      status: 'active',
      lessonId: 'lesson-order-matters',
    });
  });

  it('records Lesson 2 score, stars, XP, and isolated progress without creating Lesson 3', async () => {
    await answerAndComplete(database, firstUserId, 6);
    const completed = await answerAndComplete(database, firstUserId, 5, 'lesson-order-matters');

    expect(completed).toMatchObject({
      finalScore: 100,
      starCount: 3,
      cleared: true,
      xpImprovement: 130,
    });
    await expect(
      getLessonProgress(database, firstUserId, 'lesson-order-matters'),
    ).resolves.toMatchObject({
      status: 'cleared',
      bestScore: 100,
      bestStarCount: 3,
      attemptCount: 1,
      xpAwarded: 130,
    });
    await expect(
      getLessonProgress(database, secondUserId, 'lesson-order-matters'),
    ).resolves.toMatchObject({ status: 'locked', bestScore: 0, attemptCount: 0 });
    await expect(database.lessons.count()).resolves.toBe(2);
    await expect(database.lessonProgress.where('userId').equals(firstUserId).count()).resolves.toBe(
      2,
    );
  });
});
