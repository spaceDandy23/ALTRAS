import { describe, expect, it, vi } from 'vitest';
import type { PublicUser, StudentProfile } from '@/types/models';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock('./online-profile.service', () => ({
  getOnlineProfile: mocks.get,
  updateOnlineDisplayName: mocks.update,
}));

import { getProfile, updateDisplayName } from './profile.service';

const userId = '00000000-0000-4000-8000-000000000001';
const profile: StudentProfile = {
  id: userId,
  userId,
  displayName: 'Student One',
  createdAt: 1,
  updatedAt: 1,
};
const user: PublicUser = {
  id: userId,
  normalizedUsername: 'student_one',
  displayName: 'Updated Student',
  createdAt: 1,
  lastLoginAt: 2,
};

describe('authoritative profile service', () => {
  it('loads profiles only from Supabase', async () => {
    mocks.get.mockResolvedValue(profile);
    await expect(getProfile(userId)).resolves.toBe(profile);
    expect(mocks.get).toHaveBeenCalledWith(userId);
  });

  it('validates and persists display-name updates through Supabase', async () => {
    mocks.update.mockResolvedValue({
      profile: { ...profile, displayName: user.displayName },
      user,
    });
    await expect(updateDisplayName(userId, `  ${user.displayName}  `)).resolves.toMatchObject({
      user,
    });
    expect(mocks.update).toHaveBeenCalledWith(userId, user.displayName);
  });

  it('does not hide profile persistence failures', async () => {
    mocks.update.mockRejectedValue(new Error('Unable to update the online student profile.'));
    await expect(updateDisplayName(userId, 'Valid Name')).rejects.toThrow(
      'Unable to update the online student profile.',
    );
  });
});
