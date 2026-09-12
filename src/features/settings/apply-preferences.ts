import type { UserSettings } from '@/types/models';

export type VisualPreferences = Pick<
  UserSettings,
  'theme' | 'readabilityScale' | 'animationsEnabled'
>;

export function resolveTheme(
  preference: VisualPreferences['theme'],
  prefersDark = typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches,
) {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
}

export function applyVisualPreferences(preferences: VisualPreferences) {
  const root = document.documentElement;
  root.dataset.themePreference = preferences.theme;
  root.dataset.theme = resolveTheme(preferences.theme);
  root.dataset.motion = preferences.animationsEnabled ? 'on' : 'off';
  root.style.setProperty('--readability-scale', String(preferences.readabilityScale));
}

export function clearVisualPreferences() {
  const root = document.documentElement;
  delete root.dataset.themePreference;
  delete root.dataset.theme;
  delete root.dataset.motion;
  root.style.removeProperty('--readability-scale');
}
