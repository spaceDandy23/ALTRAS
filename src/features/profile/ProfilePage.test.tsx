import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import type { StudentProfile } from '@/types/models';
import { getProfile } from './profile.service';
import { ProfilePage } from './ProfilePage';

vi.mock('./profile.service', () => ({
  getProfile: vi.fn(),
  updateDisplayName: vi.fn(),
}));

const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';

function profile(userId: string, displayName: string): StudentProfile {
  return { id: userId, userId, displayName, createdAt: 1, updatedAt: 1 };
}

describe('profile account isolation', () => {
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ status: 'guest', user: null });
  });

  it('ignores a stale profile response after switching accounts', async () => {
    let resolveFirst!: (value: StudentProfile) => void;
    vi.mocked(getProfile).mockImplementation((userId) => {
      if (userId === firstId) {
        return new Promise<StudentProfile>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(profile(secondId, 'Second Remote'));
    });
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: firstId,
        normalizedUsername: 'first_student',
        displayName: 'First Session',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });

    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    );

    act(() => {
      useAuthStore.setState({
        status: 'authenticated',
        user: {
          id: secondId,
          normalizedUsername: 'second_student',
          displayName: 'Second Session',
          createdAt: 1,
          lastLoginAt: 1,
        },
      });
    });
    expect(await screen.findByDisplayValue('Second Remote')).toBeInTheDocument();

    await act(async () => resolveFirst(profile(firstId, 'First Remote')));
    expect(screen.getByDisplayValue('Second Remote')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('First Remote')).not.toBeInTheDocument();
  });
});
