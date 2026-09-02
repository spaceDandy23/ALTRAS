import { describe, expect, it } from 'vitest';
import { AltrasDatabase } from './database';

describe('student data exclusion from browser persistence', () => {
  it('does not define authentication, profile, settings, progress, or attempt tables', async () => {
    const database = new AltrasDatabase(`altras-content-only-${crypto.randomUUID()}`);
    await database.open();

    const tableNames = database.tables.map((table) => table.name);
    expect(tableNames).toEqual(
      expect.not.arrayContaining([
        'users',
        'profiles',
        'settings',
        'sessions',
        'lessonProgress',
        'lessonAttempts',
      ]),
    );

    await database.delete();
  });
});
