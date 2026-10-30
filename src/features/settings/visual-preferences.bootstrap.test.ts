import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserSettings } from '@/types/models';
import { clearVisualPreferences } from './apply-preferences';
import { getUserSettings } from './settings.service';
import { hydrateVisualPreferencesForUser } from './visual-preferences.bootstrap';
import {
  activateVisualPreferencesForUser,
  cacheVisualPreferences,
  deactivateVisualPreferences,
  getActiveVisualPreferencesUserId,
  primeCachedVisualPreferences,
  readCachedVisualPreferences,
} from './visual-preferences.cache';

vi.mock('./settings.service', () => ({ getUserSettings: vi.fn() }));
const setAudioVolumes = vi.hoisted(() => vi.fn());
vi.mock('@/services/audio/audio.manager', () => ({ setAudioVolumes }));

const userA = '00000000-0000-4000-8000-000000000001';
const userB = '00000000-0000-4000-8000-000000000002';

function settings(userId: string, readabilityScale: number, theme: 'dark' | 'light'): UserSettings {
  return {
    id: userId,
    userId,
    theme,
    readabilityScale,
    masterVolume: 80,
    soundEffectsVolume: 80,
    musicVolume: 60,
    animationsEnabled: false,
    updatedAt: 1,
  };
}

describe('visual preference bootstrap', () => {
  afterEach(() => {
    localStorage.clear();
    clearVisualPreferences();
    vi.clearAllMocks();
  });

  it('applies the signed-in user cache synchronously before reconciling Supabase settings', async () => {
    cacheVisualPreferences(userA, settings(userA, 1.15, 'dark'));
    activateVisualPreferencesForUser(userA);
    const authoritative = settings(userA, 1.3, 'light');
    vi.mocked(getUserSettings).mockResolvedValue(authoritative);

    primeCachedVisualPreferences();
    expect(document.documentElement.style.getPropertyValue('--readability-scale')).toBe('1.15');

    await hydrateVisualPreferencesForUser(userA);
    expect(document.documentElement.style.getPropertyValue('--readability-scale')).toBe('1.3');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('never reuses one account cache while activating another account', () => {
    cacheVisualPreferences(userA, settings(userA, 1.3, 'light'));
    activateVisualPreferencesForUser(userA);
    expect(document.documentElement.style.getPropertyValue('--readability-scale')).toBe('1.3');

    activateVisualPreferencesForUser(userB);
    expect(getActiveVisualPreferencesUserId()).toBe(userB);
    expect(document.documentElement.style.getPropertyValue('--readability-scale')).toBe('1');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('deactivates the visible preference without deleting the saved user preference', () => {
    cacheVisualPreferences(userA, settings(userA, 1.3, 'light'));
    activateVisualPreferencesForUser(userA);

    deactivateVisualPreferences();

    expect(getActiveVisualPreferencesUserId()).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--readability-scale')).toBe('1');
    expect(readCachedVisualPreferences(userA)?.readabilityScale).toBe(1.3);
  });

  it('leaves audio silent when authoritative settings cannot be resolved', async () => {
    vi.mocked(getUserSettings).mockRejectedValue(new Error('offline'));
    await hydrateVisualPreferencesForUser(userB);
    expect(setAudioVolumes).not.toHaveBeenCalled();
  });
});
