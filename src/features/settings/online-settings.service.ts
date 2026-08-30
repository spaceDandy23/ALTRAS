import { z } from 'zod';
import { getSupabaseClient } from '@/services/supabase.client';
import { settingsSchema, type UserSettings } from '@/types/models';
import type { SettingsUpdate } from './settings.service';

const remoteSettingsSchema = z.object({
  user_id: z.string().uuid(),
  master_volume: z.number().int(),
  sound_effects_volume: z.number().int(),
  music_volume: z.number().int(),
  animations_enabled: z.boolean(),
  updated_at: z.string(),
});

function toUserSettings(input: z.infer<typeof remoteSettingsSchema>): UserSettings {
  return settingsSchema.parse({
    id: input.user_id,
    userId: input.user_id,
    masterVolume: input.master_volume,
    soundEffectsVolume: input.sound_effects_volume,
    musicVolume: input.music_volume,
    animationsEnabled: input.animations_enabled,
    updatedAt: Date.parse(input.updated_at),
  });
}

export async function getOnlineUserSettings(userId: string): Promise<UserSettings> {
  const { data, error } = await getSupabaseClient()
    .from('user_settings')
    .select(
      'user_id, master_volume, sound_effects_volume, music_volume, animations_enabled, updated_at',
    )
    .eq('user_id', userId)
    .single();

  if (error) throw new Error('Unable to load online settings.');
  return toUserSettings(remoteSettingsSchema.parse(data));
}

export async function updateOnlineUserSettings(
  userId: string,
  update: SettingsUpdate,
): Promise<UserSettings> {
  const remoteChanges = {
    ...(update.masterVolume === undefined ? {} : { master_volume: update.masterVolume }),
    ...(update.soundEffectsVolume === undefined
      ? {}
      : { sound_effects_volume: update.soundEffectsVolume }),
    ...(update.musicVolume === undefined ? {} : { music_volume: update.musicVolume }),
    ...(update.animationsEnabled === undefined
      ? {}
      : { animations_enabled: update.animationsEnabled }),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await getSupabaseClient()
    .from('user_settings')
    .update(remoteChanges)
    .eq('user_id', userId)
    .select(
      'user_id, master_volume, sound_effects_volume, music_volume, animations_enabled, updated_at',
    )
    .single();

  if (error) throw new Error('Unable to save online settings.');
  return toUserSettings(remoteSettingsSchema.parse(data));
}
