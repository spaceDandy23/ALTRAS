import { describe, expect, it } from 'vitest';
import { AltrasDatabase } from './database';

describe('database initialization', () => {
  it('opens the versioned schema and preserves records when reopened', async () => {
    const name = `altras-schema-${crypto.randomUUID()}`;
    const first = new AltrasDatabase(name);
    await first.open();

    expect(first.verno).toBe(2);
    expect(first.tables.map((table) => table.name).sort()).toEqual([
      'contentVersions',
      'lessonAttempts',
      'lessonItems',
      'lessonProgress',
      'lessons',
      'profiles',
      'sections',
      'sessions',
      'settings',
      'units',
      'users',
    ]);

    const marker = {
      id: crypto.randomUUID(),
      normalizedUsername: 'migration_marker',
      displayName: 'Migration Marker',
      passwordHash: 'derived-value',
      passwordSalt: 'random-salt',
      passwordDerivation: {
        algorithm: 'PBKDF2' as const,
        hash: 'SHA-256' as const,
        iterations: 310_000,
        keyLength: 256 as const,
        version: 1 as const,
      },
      createdAt: Date.now(),
      lastLoginAt: null,
    };
    await first.users.add(marker);
    first.close();

    const reopened = new AltrasDatabase(name);
    await reopened.open();
    await expect(reopened.users.get(marker.id)).resolves.toMatchObject({
      normalizedUsername: 'migration_marker',
    });
    await reopened.delete();
  });
});
