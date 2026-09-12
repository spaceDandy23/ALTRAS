import { z } from 'zod';
import type { UserSettings } from '@/types/models';
import {
  applyVisualPreferences,
  clearVisualPreferences,
  type VisualPreferences,
} from './apply-preferences';

const ACTIVE_USER_KEY = 'altras.visual-preferences.active-user.v1';
const CACHE_PREFIX = 'altras.visual-preferences.user.v1.';

const cachedVisualPreferencesSchema = z.object({
  userId: z.string().min(1),
  theme: z.enum(['light', 'dark', 'system']),
  readabilityScale: z.number().min(1).max(1.3),
  animationsEnabled: z.boolean(),
});

const defaultVisualPreferences: VisualPreferences = {
  theme: 'dark',
  readabilityScale: 1,
  animationsEnabled: true,
};

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function cacheKey(userId: string) {
  return `${CACHE_PREFIX}${userId}`;
}

export function readCachedVisualPreferences(userId: string): VisualPreferences | null {
  const stored = storage()?.getItem(cacheKey(userId));
  if (!stored) return null;

  try {
    const parsed = cachedVisualPreferencesSchema.parse(JSON.parse(stored));
    return parsed.userId === userId
      ? {
          theme: parsed.theme,
          readabilityScale: parsed.readabilityScale,
          animationsEnabled: parsed.animationsEnabled,
        }
      : null;
  } catch {
    storage()?.removeItem(cacheKey(userId));
    return null;
  }
}

export function cacheVisualPreferences(userId: string, settings: VisualPreferences) {
  try {
    storage()?.setItem(
      cacheKey(userId),
      JSON.stringify({
        userId,
        theme: settings.theme,
        readabilityScale: settings.readabilityScale,
        animationsEnabled: settings.animationsEnabled,
      }),
    );
  } catch {
    // Visual preferences still work for this session when storage is unavailable.
  }
}

function applyDefaults() {
  clearVisualPreferences();
  applyVisualPreferences(defaultVisualPreferences);
}

export function activateVisualPreferencesForUser(userId: string): VisualPreferences | null {
  try {
    storage()?.setItem(ACTIVE_USER_KEY, userId);
  } catch {
    // Continue with in-memory DOM preferences.
  }
  const cached = readCachedVisualPreferences(userId);
  if (cached) applyVisualPreferences(cached);
  else applyDefaults();
  return cached;
}

export function primeCachedVisualPreferences() {
  const activeUserId = storage()?.getItem(ACTIVE_USER_KEY);
  if (!activeUserId) {
    applyDefaults();
    return;
  }

  const cached = readCachedVisualPreferences(activeUserId);
  if (cached) applyVisualPreferences(cached);
  else applyDefaults();
}

export function applyAuthoritativeVisualPreferences(userId: string, settings: UserSettings) {
  cacheVisualPreferences(userId, settings);
  if (storage()?.getItem(ACTIVE_USER_KEY) === userId) applyVisualPreferences(settings);
}

export function deactivateVisualPreferences() {
  storage()?.removeItem(ACTIVE_USER_KEY);
  applyDefaults();
}

export function getActiveVisualPreferencesUserId() {
  return storage()?.getItem(ACTIVE_USER_KEY) ?? null;
}
