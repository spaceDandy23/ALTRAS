import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { hydrateVisualPreferencesForUser } from '@/features/settings/visual-preferences.bootstrap';
import { deactivateVisualPreferences } from '@/features/settings/visual-preferences.cache';
import { AppShell } from './AppShell';

describe('stored motion preference', () => {
  afterEach(async () => {
    deactivateVisualPreferences();
    await db.settings.clear();
    useAuthStore.setState({ status: 'guest', user: null });
  });

  it('applies a stored disabled-animation preference before the application shell renders', async () => {
    const userId = crypto.randomUUID();
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'motion_student',
        displayName: 'Motion Student',
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
      },
    });
    await db.settings.put({
      id: crypto.randomUUID(),
      userId,
      theme: 'dark',
      readabilityScale: 1,
      masterVolume: 80,
      soundEffectsVolume: 80,
      musicVolume: 60,
      animationsEnabled: false,
      updatedAt: Date.now(),
    });

    await hydrateVisualPreferencesForUser(userId);
    expect(document.documentElement.dataset.motion).toBe('off');

    render(
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<p>Student area</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(document.documentElement.dataset.motion).toBe('off');
  });
});
