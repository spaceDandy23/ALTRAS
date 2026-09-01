import type { AltrasDatabase } from '@/db/database';
import { settingsSchema, type UserSettings } from '@/types/models';
import { z } from 'zod';
import { isSupabaseConfigured } from '@/services/supabase.client';
import { getOnlineUserSettings, updateOnlineUserSettings } from './online-settings.service';
import { cacheVisualPreferences } from './visual-preferences.cache';

export const settingsUpdateSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  readabilityScale: z.number().min(1).max(1.3).optional(),
  masterVolume: z.number().int().min(0).max(100).optional(),
  soundEffectsVolume: z.number().int().min(0).max(100).optional(),
  musicVolume: z.number().int().min(0).max(100).optional(),
  animationsEnabled: z.boolean().optional(),
});

export type SettingsUpdate = z.input<typeof settingsUpdateSchema>;

const userSaveQueues = new Map<string, Promise<void>>();

async function loadUserSettings(database: AltrasDatabase, userId: string): Promise<UserSettings> {
  if (isSupabaseConfigured) return getOnlineUserSettings(userId);
  const stored = await database.settings.get({ userId });
  if (!stored) throw new Error('Settings could not be found for this local account.');
  return settingsSchema.parse(stored);
}

export async function getUserSettings(
  database: AltrasDatabase,
  userId: string,
): Promise<UserSettings> {
  const pendingSave = userSaveQueues.get(userId);
  if (pendingSave) await pendingSave;
  const loaded = await loadUserSettings(database, userId);
  cacheVisualPreferences(userId, loaded);
  return loaded;
}

export function updateUserSettings(
  database: AltrasDatabase,
  userId: string,
  update: SettingsUpdate,
): Promise<UserSettings> {
  const changes = settingsUpdateSchema.parse(update);
  const previousSave = userSaveQueues.get(userId) ?? Promise.resolve();
  const saveOperation = previousSave.then(async () => {
    if (isSupabaseConfigured) {
      const saved = await updateOnlineUserSettings(userId, changes);
      cacheVisualPreferences(userId, saved);
      return saved;
    }

    const current = await loadUserSettings(database, userId);
    const next = settingsSchema.parse({ ...current, ...changes, updatedAt: Date.now() });
    await database.settings.put(next);
    cacheVisualPreferences(userId, next);
    return next;
  });
  const queueTail = saveOperation.then(
    () => undefined,
    () => undefined,
  );
  userSaveQueues.set(userId, queueTail);
  void queueTail.finally(() => {
    if (userSaveQueues.get(userId) === queueTail) userSaveQueues.delete(userId);
  });
  return saveOperation;
}
