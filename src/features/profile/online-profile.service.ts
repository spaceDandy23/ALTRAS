import { z } from 'zod';
import { getSupabaseClient } from '@/services/supabase.client';
import { profileSchema, type PublicUser, type StudentProfile } from '@/types/models';

const remoteProfileSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string().min(2).max(40),
  created_at: z.string(),
  updated_at: z.string(),
});

function toStudentProfile(input: z.infer<typeof remoteProfileSchema>): StudentProfile {
  return profileSchema.parse({
    id: input.user_id,
    userId: input.user_id,
    displayName: input.display_name,
    createdAt: Date.parse(input.created_at),
    updatedAt: Date.parse(input.updated_at),
  });
}

export async function getOnlineProfile(userId: string): Promise<StudentProfile> {
  const { data, error } = await getSupabaseClient()
    .from('profiles')
    .select('user_id, display_name, created_at, updated_at')
    .eq('user_id', userId)
    .single();

  if (error) throw new Error('Unable to load the online student profile.');
  return toStudentProfile(remoteProfileSchema.parse(data));
}

export async function updateOnlineDisplayName(
  userId: string,
  displayName: string,
): Promise<{ profile: StudentProfile; user: PublicUser }> {
  const supabase = getSupabaseClient();
  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: displayName, updated_at: updatedAt })
    .eq('user_id', userId)
    .select('user_id, display_name, created_at, updated_at')
    .single();

  if (error) throw new Error('Unable to update the online student profile.');

  const { data: authData, error: authError } = await supabase.auth.updateUser({
    data: { display_name: displayName },
  });
  if (authError) throw new Error('The profile changed, but the session could not be refreshed.');

  const authUser = authData.user;
  const normalizedUsername = String(authUser.user_metadata.username ?? '').trim();
  const profile = toStudentProfile(remoteProfileSchema.parse(data));
  return {
    profile,
    user: {
      id: authUser.id,
      normalizedUsername,
      displayName,
      createdAt: Date.parse(authUser.created_at),
      lastLoginAt: authUser.last_sign_in_at ? Date.parse(authUser.last_sign_in_at) : null,
    },
  };
}
