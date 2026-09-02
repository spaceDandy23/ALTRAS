import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AltrasDatabase } from '@/db/database';
import { packagedContent } from './packaged-content';
import {
  ContentInitializationError,
  getLesson,
  initializePackagedContent,
} from './content.service';

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

  it('round-trips lesson and activity character overrides through local content storage', async () => {
    const customized = structuredClone(packagedContent);
    customized.lessons[0].characterId = 'altras-guide';
    customized.lessons[0].characterDialogue = {
      introduction: 'Stored introduction.',
      completion: 'Stored completion.',
    };
    customized.lessons[0].activities[0].characterDialogue = {
      hint: 'Stored hint.',
      correct: 'Stored correct reaction.',
    };

    await initializePackagedContent(database, customized);
    const lesson = await getLesson(database, customized.lessons[0].id);

    expect(lesson).toMatchObject({
      characterId: 'altras-guide',
      characterDialogue: {
        introduction: 'Stored introduction.',
        completion: 'Stored completion.',
      },
    });
    expect(lesson.activities[0].characterDialogue).toEqual({
      hint: 'Stored hint.',
      correct: 'Stored correct reaction.',
    });
  });

  it('refreshes packaged lesson metadata and items idempotently', async () => {
    await initializePackagedContent(database);
    const lessonTwo = await database.lessons.get('lesson-order-matters');
    if (!lessonTwo) throw new Error('Missing Lesson 2 metadata.');
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
    await expect(
      database.lessonItems.where('lessonId').equals('lesson-order-matters').count(),
    ).resolves.toBe(11);
  });
});
