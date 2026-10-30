import { z } from 'zod';
import { getSupabaseClient } from '@/services/supabase.client';

const streakSchema = z.object({
  user_id: z.string().uuid(),
  current_streak: z.number().int().nonnegative(),
  longest_streak: z.number().int().nonnegative(),
  last_activity_date: z.iso.date().nullable(),
  earned_today: z.boolean(),
  celebrate: z.boolean(),
  calendar_timezone: z.literal('Asia/Manila'),
  refresh_after_seconds: z.number().positive().max(86400),
});

export type StudentStreak = z.infer<typeof streakSchema>;

// Coalesce concurrent mounts/Strict Mode requests, but never cache stale streak data.
const pending = new Map<string, Promise<StudentStreak>>();

export function getStudentStreak(userId: string, attemptId?: string): Promise<StudentStreak> {
  const key = `${userId}:${attemptId ?? 'summary'}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    const { data, error } = await getSupabaseClient().rpc('get_student_streak', {
      p_attempt_id: attemptId ?? null,
    });
    if (error) throw new Error('Your streak could not be loaded.');
    const streak = streakSchema.parse(data);
    if (streak.user_id !== userId) throw new Error('The streak belongs to another account.');
    return streak;
  })();
  pending.set(key, request);
  void request
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    })
    .catch(() => undefined);
  return request;
}
