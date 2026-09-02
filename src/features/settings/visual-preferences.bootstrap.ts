import { applyVisualPreferences } from './apply-preferences';
import { getUserSettings } from './settings.service';
import { setAudioVolumes } from '@/services/audio/audio.manager';
import {
  activateVisualPreferencesForUser,
  applyAuthoritativeVisualPreferences,
  getActiveVisualPreferencesUserId,
} from './visual-preferences.cache';

export async function hydrateVisualPreferencesForUser(userId: string): Promise<void> {
  const cached = activateVisualPreferencesForUser(userId);

  try {
    const authoritative = await getUserSettings(userId);
    applyAuthoritativeVisualPreferences(userId, authoritative);
    setAudioVolumes({
      masterVolume: authoritative.masterVolume,
      soundEffectsVolume: authoritative.soundEffectsVolume,
      musicVolume: authoritative.musicVolume,
    });
  } catch {
    if (cached && getActiveVisualPreferencesUserId() === userId) {
      applyVisualPreferences(cached);
    }
    // Keep the cached or normal defaults visible. Settings can retry once the app is open.
  }
}
