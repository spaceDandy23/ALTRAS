import type { AltrasDatabase } from '@/db/database';
import {
  profileSchema,
  toPublicUser,
  userSchema,
  type PublicUser,
  type StudentProfile,
} from '@/types/models';
import { z } from 'zod';
import { isSupabaseConfigured } from '@/services/supabase.client';
import { getOnlineProfile, updateOnlineDisplayName } from './online-profile.service';

const displayNameSchema = z.string().trim().min(2).max(40);

export async function getProfile(
  database: AltrasDatabase,
  userId: string,
): Promise<StudentProfile> {
  if (isSupabaseConfigured) return getOnlineProfile(userId);
  return profileSchema.parse(await database.profiles.get({ userId }));
}

export async function updateDisplayName(
  database: AltrasDatabase,
  userId: string,
  displayNameInput: string,
): Promise<{ profile: StudentProfile; user: PublicUser }> {
  const displayName = displayNameSchema.parse(displayNameInput);
  if (isSupabaseConfigured) return updateOnlineDisplayName(userId, displayName);

  const updatedAt = Date.now();
  const profile = await getProfile(database, userId);
  const storedUser = userSchema.parse(await database.users.get(userId));
  const nextProfile = profileSchema.parse({ ...profile, displayName, updatedAt });
  const nextUser = userSchema.parse({ ...storedUser, displayName });

  await database.transaction('rw', [database.profiles, database.users], async () => {
    await database.profiles.put(nextProfile);
    await database.users.put(nextUser);
  });

  return { profile: nextProfile, user: toPublicUser(nextUser) };
}
