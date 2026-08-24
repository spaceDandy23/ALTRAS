import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AltrasDatabase } from '@/db/database';
import { packagedContent } from './packaged-content';
import {
  ContentInitializationError,
  getLesson,
  initializePackagedContent,
} from './content.service';
import { lessonAttemptSchema, lessonProgressSchema } from '@/types/learning';

describe('packaged content initialization', () => {
  let database: AltrasDatabase;

  beforeEach(() => {
    database = new AltrasDatabase(`altras-content-${crypto.randomUUID()}`);
  });
  afterEach(async () => database.delete());

  it('is idempotent and records content version independently', async () => {
    await initializePackagedContent(database);
    const firstCounts = await Promise.all([
      database.sections.count(),
      database.units.count(),
      database.lessons.count(),
      database.lessonItems.count(),
    ]);
    await initializePackagedContent(database);

    await expect(
      Promise.all([
        database.sections.count(),
        database.units.count(),
        database.lessons.count(),
        database.lessonItems.count(),
      ]),
    ).resolves.toEqual(firstCounts);
    await expect(database.contentVersions.get('packaged-content')).resolves.toMatchObject({
      version: packagedContent.version,
    });
  });

  it('fails before storing any rows when content is invalid', async () => {
    await expect(
      initializePackagedContent(database, { ...packagedContent, sections: [] }),
    ).rejects.toBeInstanceOf(ContentInitializationError);
    await expect(database.lessons.count()).resolves.toBe(0);
  });

  it('upgrades an unlocked Lesson 2 without changing Lesson 1 attempts or progress', async () => {
    await initializePackagedContent(database);
    const userId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const lessonTwo = await database.lessons.get('lesson-order-matters');
    if (!lessonTwo) throw new Error('Missing Lesson 2 metadata.');

    const lessonOneProgress = lessonProgressSchema.parse({
      id: `${userId}:lesson-operation-signals`,
      userId,
      lessonId: 'lesson-operation-signals',
      status: 'cleared',
      bestScore: 83,
      bestStarCount: 1,
      attemptCount: 1,
      xpAwarded: 93,
      firstStartedAt: 10,
      lastAttemptedAt: 20,
      clearedAt: 20,
    });
    const lessonTwoProgress = lessonProgressSchema.parse({
      id: `${userId}:lesson-order-matters`,
      userId,
      lessonId: 'lesson-order-matters',
      status: 'available',
      bestScore: 0,
      bestStarCount: 0,
      attemptCount: 0,
      xpAwarded: 0,
      firstStartedAt: null,
      lastAttemptedAt: null,
      clearedAt: null,
    });
    const lessonOneAttempt = lessonAttemptSchema.parse({
      id: attemptId,
      userId,
      lessonId: 'lesson-operation-signals',
      contentVersion: 1,
      status: 'completed',
      startedAt: 10,
      lastUpdatedAt: 20,
      completedAt: 20,
      abandonedAt: null,
      answers: [],
      finalScore: 83,
      starCount: 1,
      cleared: true,
      xpImprovement: 93,
    });

    await database.lessonProgress.bulkPut([lessonOneProgress, lessonTwoProgress]);
    await database.lessonAttempts.put(lessonOneAttempt);
    await database.lessons.put({ ...lessonTwo, contentStatus: 'preview', contentVersion: 1 });
    await database.lessonItems.where('lessonId').equals('lesson-order-matters').delete();

    await initializePackagedContent(database);
    await initializePackagedContent(database);

    const upgradedLesson = await getLesson(database, 'lesson-order-matters');
    expect(upgradedLesson).toMatchObject({
      contentStatus: 'playable',
      contentVersion: 2,
    });
    expect(upgradedLesson.activities).toHaveLength(5);
    await expect(database.lessonProgress.get(lessonOneProgress.id)).resolves.toEqual(
      lessonOneProgress,
    );
    await expect(database.lessonProgress.get(lessonTwoProgress.id)).resolves.toEqual(
      lessonTwoProgress,
    );
    await expect(database.lessonAttempts.get(attemptId)).resolves.toEqual(lessonOneAttempt);
    await expect(
      database.lessonItems.where('lessonId').equals('lesson-order-matters').count(),
    ).resolves.toBe(11);
  });
});
