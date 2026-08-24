import type { AltrasDatabase } from '@/db/database';
import { settingsSchema, type UserSettings } from '@/types/models';
import { z } from 'zod';

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
  const current = await getUserSettings(database, userId);
  const next = settingsSchema.parse({ ...current, ...changes, updatedAt: Date.now() });
  await database.settings.put(next);
  return next;
}
