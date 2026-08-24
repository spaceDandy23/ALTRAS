import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { AppShell } from './AppShell';

describe('stored motion preference', () => {
  afterEach(async () => {
    delete document.documentElement.dataset.motion;
    await db.settings.clear();
    useAuthStore.setState({ status: 'guest', user: null });
  });

  it('applies a stored disabled-animation preference to the application shell', async () => {
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
      masterVolume: 80,
      soundEffectsVolume: 80,
      musicVolume: 60,
      animationsEnabled: false,
      updatedAt: Date.now(),
    });

    render(
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<p>Student area</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(document.documentElement.dataset.motion).toBe('off'));
  });
});
