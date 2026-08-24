import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import type { UserSettings } from '@/types/models';
import { SettingsPage } from './SettingsPage';
import { getUserSettings, updateUserSettings } from './settings.service';

vi.mock('./settings.service', () => ({
  getUserSettings: vi.fn(),
  updateUserSettings: vi.fn(),
}));

const initialSettings: UserSettings = {
  id: 'settings-1',
  userId: 'user-1',
  masterVolume: 80,
  soundEffectsVolume: 80,
  musicVolume: 60,
  animationsEnabled: true,
  updatedAt: 1,
};

describe('settings save status', () => {
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ status: 'guest', user: null });
  });

  it('shows Saved only after the newest slider value is persisted', async () => {
    let resolveFirst!: (settings: UserSettings) => void;
    let resolveSecond!: (settings: UserSettings) => void;

    vi.mocked(getUserSettings).mockResolvedValue(initialSettings);
    vi.mocked(updateUserSettings)
      .mockImplementationOnce(
        () => new Promise<UserSettings>((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise<UserSettings>((resolve) => (resolveSecond = resolve)),
      );
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: 'user-1',
        normalizedUsername: 'slider_student',
        displayName: 'Slider Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    const slider = await screen.findByRole('slider', { name: /master volume/i });
    const saveStatus = document.querySelector('.save-state');
    fireEvent.change(slider, { target: { value: '75' } });
    expect(updateUserSettings).not.toHaveBeenCalled();
    expect(saveStatus).toBeEmptyDOMElement();

    fireEvent.pointerUp(slider);
    await waitFor(() => expect(updateUserSettings).toHaveBeenCalledTimes(1));
    fireEvent.change(slider, { target: { value: '70' } });
    expect(screen.queryByText('Saving…', { selector: '.save-state' })).not.toBeInTheDocument();
    fireEvent.pointerUp(slider);

    expect(saveStatus).toHaveTextContent('Saving…');

    await act(async () => {
      resolveFirst({ ...initialSettings, masterVolume: 75, updatedAt: 2 });
    });

    await waitFor(() => expect(updateUserSettings).toHaveBeenCalledTimes(2));
    expect(saveStatus).toHaveTextContent('Saving…');
    expect(saveStatus).not.toHaveTextContent('Saved');

    await act(async () => {
      resolveSecond({ ...initialSettings, masterVolume: 70, updatedAt: 3 });
    });

    await waitFor(() => expect(saveStatus).toHaveTextContent('✓ Saved'));
    expect(slider).toHaveValue('70');
  });
});
