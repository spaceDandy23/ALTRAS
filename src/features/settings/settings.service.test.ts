import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUserSettings, updateUserSettings } from './settings.service';
import { readCachedVisualPreferences } from './visual-preferences.cache';
import type { UserSettings } from '@/types/models';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock('./online-settings.service', () => ({
  getOnlineUserSettings: mocks.get,
  updateOnlineUserSettings: mocks.update,
}));

const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';

function settings(userId: string, update: Partial<UserSettings> = {}): UserSettings {
  return {
    id: userId,
    userId,
    theme: 'dark',
    readabilityScale: 1,
    masterVolume: 80,
    soundEffectsVolume: 80,
    musicVolume: 60,
    animationsEnabled: true,
    updatedAt: 1,
    ...update,
  };
}

describe('authoritative per-user settings', () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('persists through Supabase and keeps visual caches isolated by user ID', async () => {
    mocks.update.mockResolvedValue(
      settings(firstId, { masterVolume: 25, musicVolume: 10, animationsEnabled: false }),
    );
    mocks.get.mockResolvedValue(settings(secondId));

    await updateUserSettings(firstId, {
      masterVolume: 25,
      musicVolume: 10,
      animationsEnabled: false,
    });
    await expect(getUserSettings(secondId)).resolves.toMatchObject({
      masterVolume: 80,
      musicVolume: 60,
      animationsEnabled: true,
    });
    expect(mocks.update).toHaveBeenCalledWith(
      firstId,
      expect.objectContaining({ masterVolume: 25, animationsEnabled: false }),
    );
    expect(readCachedVisualPreferences(firstId)).toMatchObject({ animationsEnabled: false });
    expect(readCachedVisualPreferences(secondId)).toMatchObject({ animationsEnabled: true });
  });

  it('serializes rapid updates and lets a reload wait for the newest settings', async () => {
    let authoritative = settings(firstId);
    mocks.update.mockImplementation(async (_userId, update) => {
      authoritative = settings(firstId, { ...authoritative, ...update, updatedAt: Date.now() });
      return authoritative;
    });
    mocks.get.mockImplementation(async () => authoritative);

    const themeSave = updateUserSettings(firstId, { theme: 'light' });
    const textSave = updateUserSettings(firstId, { readabilityScale: 1.3 });
    const motionSave = updateUserSettings(firstId, { animationsEnabled: false });

    await expect(getUserSettings(firstId)).resolves.toMatchObject({
      theme: 'light',
      readabilityScale: 1.3,
      animationsEnabled: false,
    });
    await Promise.all([themeSave, textSave, motionSave]);
    expect(mocks.update.mock.calls.map((call) => call[1])).toEqual([
      { theme: 'light' },
      { readabilityScale: 1.3 },
      { animationsEnabled: false },
    ]);
    expect(readCachedVisualPreferences(firstId)).toEqual({
      theme: 'light',
      readabilityScale: 1.3,
      animationsEnabled: false,
    });
  });

  it('does not replace the visual cache when the authoritative save fails', async () => {
    mocks.get.mockResolvedValue(settings(firstId, { theme: 'dark', readabilityScale: 1 }));
    await getUserSettings(firstId);
    mocks.update.mockRejectedValue(new Error('Unable to save online settings.'));

    await expect(updateUserSettings(firstId, { theme: 'light' })).rejects.toThrow(
      'Unable to save online settings.',
    );
    expect(readCachedVisualPreferences(firstId)).toMatchObject({ theme: 'dark' });
  });
});
