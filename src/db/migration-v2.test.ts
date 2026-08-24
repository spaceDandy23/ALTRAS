import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { AltrasDatabase } from './database';

describe('Phase 1 to Phase 2 database migration', () => {
  it('preserves representative v1 account, profile, settings, and session records', async () => {
    const name = `altras-v1-upgrade-${crypto.randomUUID()}`;
    const userId = crypto.randomUUID();
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      users: 'id,&normalizedUsername,createdAt,lastLoginAt',
      profiles: 'id,&userId,updatedAt',
      settings: 'id,&userId,updatedAt',
      sessions: 'id,userId,createdAt,lastAccessedAt,expiresAt',
    });
    await legacy.open();
    const now = Date.now();
    await legacy.table('users').add({
      id: userId,
      normalizedUsername: 'phase_one_student',
      displayName: 'Phase One Student',
      passwordHash: 'derived',
      passwordSalt: 'salt',
      passwordDerivation: {
        algorithm: 'PBKDF2',
        hash: 'SHA-256',
        iterations: 310_000,
        keyLength: 256,
        version: 1,
      },
      createdAt: now,
      lastLoginAt: now,
    });
    await legacy.table('profiles').add({
      id: crypto.randomUUID(),
      userId,
      displayName: 'Phase One Student',
      createdAt: now,
      updatedAt: now,
    });
    await legacy.table('settings').add({
      id: crypto.randomUUID(),
      userId,
      masterVolume: 25,
      soundEffectsVolume: 35,
      musicVolume: 45,
      animationsEnabled: false,
      updatedAt: now,
    });
    await legacy.table('sessions').add({
      id: crypto.randomUUID(),
      userId,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: now + 10_000,
    });
    legacy.close();

    const upgraded = new AltrasDatabase(name);
    await upgraded.open();

    expect(upgraded.verno).toBe(2);
    await expect(upgraded.users.get(userId)).resolves.toMatchObject({
      normalizedUsername: 'phase_one_student',
    });
    await expect(upgraded.profiles.where('userId').equals(userId).first()).resolves.toMatchObject({
      displayName: 'Phase One Student',
    });
    await expect(upgraded.settings.where('userId').equals(userId).first()).resolves.toMatchObject({
      animationsEnabled: false,
    });
    await expect(upgraded.sessions.where('userId').equals(userId).count()).resolves.toBe(1);
    expect(upgraded.tables.map((table) => table.name)).toContain('lessonAttempts');
    await upgraded.delete();
  });
});
