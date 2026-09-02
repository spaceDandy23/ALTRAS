import { describe, expect, it } from 'vitest';
import { AltrasDatabase } from './database';

describe('content cache database', () => {
  it('contains only lesson-content tables and preserves cached content when reopened', async () => {
    const name = `altras-content-${crypto.randomUUID()}`;
    const first = new AltrasDatabase(name);
    await first.open();

    expect(first.verno).toBe(1);
    expect(first.tables.map((table) => table.name).sort()).toEqual([
      'contentVersions',
      'lessonItems',
      'lessons',
      'sections',
      'units',
    ]);

    await first.contentVersions.add({
      id: 'packaged-content',
      version: 1,
      installedAt: Date.now(),
    });
    first.close();

    const reopened = new AltrasDatabase(name);
    await reopened.open();
    await expect(reopened.contentVersions.get('packaged-content')).resolves.toMatchObject({
      version: 1,
    });
    await reopened.delete();
  });
});
