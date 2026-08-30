import type { AltrasDatabase } from '@/db/database';
import { settingsSchema, type UserSettings } from '@/types/models';
import { z } from 'zod';
import { isSupabaseConfigured } from '@/services/supabase.client';
import { getOnlineUserSettings, updateOnlineUserSettings } from './online-settings.service';

export const settingsUpdateSchema = settingsSchema
  .pick({
    masterVolume: true,
    soundEffectsVolume: true,
    musicVolume: true,
    animationsEnabled: true,
  })
  .partial();

export type SettingsUpdate = z.input<typeof settingsUpdateSchema>;

export async function getUserSettings(
  database: AltrasDatabase,
  userId: string,
): Promise<UserSettings> {
  if (isSupabaseConfigured) return getOnlineUserSettings(userId);
  const stored = await database.settings.get({ userId });
  if (!stored) throw new Error('Settings could not be found for this local account.');
  return settingsSchema.parse(stored);
}

export async function updateUserSettings(
  database: AltrasDatabase,
  userId: string,
  update: SettingsUpdate,
): Promise<UserSettings> {
  const changes = settingsUpdateSchema.parse(update);
  if (isSupabaseConfigured) return updateOnlineUserSettings(userId, changes);

  const current = await getUserSettings(database, userId);
  const next = settingsSchema.parse({ ...current, ...changes, updatedAt: Date.now() });
  await database.settings.put(next);
  return next;
}
