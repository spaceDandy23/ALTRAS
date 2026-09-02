import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';

const audio = vi.hoisted(() => ({
  getAudioMuted: vi.fn(() => false),
  playMusic: vi.fn(),
  playSfx: vi.fn(),
  setAudioMuted: vi.fn(),
  stopMusic: vi.fn(),
}));

vi.mock('@/services/audio/audio.manager', () => audio);

import { AppShell } from './AppShell';

describe('authenticated audio mute control', () => {
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ status: 'guest', user: null });
    useResearcherAccessStore.setState({ status: 'idle', userId: null });
  });

  it('toggles a keyboard-accessible temporary mute layer without exposing settings controls', async () => {
    const userId = '10000000-0000-4000-8000-000000000001';
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: userId,
        normalizedUsername: 'audio_student',
        displayName: 'Audio Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useResearcherAccessStore.setState({ status: 'denied', userId });

    render(
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<p>Student area</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const mute = screen.getByRole('button', { name: 'Mute audio' });
    await userEvent.setup().click(mute);

    expect(audio.setAudioMuted).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { name: 'Unmute audio' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
