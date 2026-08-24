import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AltrasDatabase } from '@/db/database';
import { packagedContent } from './packaged-content';
import { ContentInitializationError, initializePackagedContent } from './content.service';

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
});
