import type { PublicUser, StudentProfile } from '@/types/models';
import { z } from 'zod';
import { getOnlineProfile, updateOnlineDisplayName } from './online-profile.service';

const displayNameSchema = z.string().trim().min(2).max(40);

export async function getProfile(userId: string): Promise<StudentProfile> {
  return getOnlineProfile(userId);
}

export async function updateDisplayName(
  userId: string,
  displayNameInput: string,
): Promise<{ profile: StudentProfile; user: PublicUser }> {
  const displayName = displayNameSchema.parse(displayNameInput);
  return updateOnlineDisplayName(userId, displayName);
}
