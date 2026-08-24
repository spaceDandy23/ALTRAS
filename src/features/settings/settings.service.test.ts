import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AltrasDatabase } from '@/db/database';
import { registerUser } from '@/features/auth/auth.service';
import { getUserSettings, updateUserSettings } from './settings.service';

describe('per-user settings', () => {
  let database: AltrasDatabase;

  beforeEach(() => {
    database = new AltrasDatabase(`altras-settings-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    await database.delete();
  });

  it('persists independent settings for each local student', async () => {
    const first = await registerUser(database, {
      username: 'first_student',
      displayName: 'First',
      password: 'Number123',
      confirmPassword: 'Number123',
    });
    const second = await registerUser(database, {
      username: 'second_student',
      displayName: 'Second',
      password: 'Number456',
      confirmPassword: 'Number456',
    });

    await updateUserSettings(database, first.id, {
      masterVolume: 25,
      musicVolume: 10,
      animationsEnabled: false,
    });

    await expect(getUserSettings(database, first.id)).resolves.toMatchObject({
      masterVolume: 25,
      musicVolume: 10,
      animationsEnabled: false,
    });
    await expect(getUserSettings(database, second.id)).resolves.toMatchObject({
      masterVolume: 80,
      musicVolume: 60,
      animationsEnabled: true,
    });
  });
});
