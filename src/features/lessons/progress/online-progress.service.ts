import { z } from 'zod';
import type { AltrasDatabase } from '@/db/database';
import { getSupabaseClient } from '@/services/supabase.client';
import { assertParticipantLearningAccess } from '@/stores/researcher-access.store';
import { lessonProgressSchema, type LessonProgress, type StoredLesson } from '@/types/learning';
import { getAllLessons } from '../content/content.service';
import type { LessonHubData } from './progress.service';

const remoteProgressSchema = z.object({
  user_id: z.string().uuid(),
  lesson_id: z.string().min(1),
  status: z.enum(['locked', 'available', 'in-progress', 'cleared']),
  best_score: z.number().int(),
  best_star_count: z.number().int(),
  attempt_count: z.number().int(),
  xp_awarded: z.number().int(),
  first_started_at: z.string().nullable(),
  last_attempted_at: z.string().nullable(),
  cleared_at: z.string().nullable(),
});

const progressColumns =
  'user_id, lesson_id, status, best_score, best_star_count, attempt_count, xp_awarded, first_started_at, last_attempted_at, cleared_at';

interface RemoteProgressWrite {
  user_id: string;
  lesson_id: string;
  status: LessonProgress['status'];
  best_score: number;
  best_star_count: number;
  attempt_count: number;
  xp_awarded: number;
  first_started_at: string | null;
  last_attempted_at: string | null;
  cleared_at: string | null;
}

function timestamp(value: string | null): number | null {
  return value ? Date.parse(value) : null;
}

export function toLessonProgress(input: unknown): LessonProgress {
  const record = remoteProgressSchema.parse(input);
  return lessonProgressSchema.parse({
    id: `${record.user_id}:${record.lesson_id}`,
    userId: record.user_id,
    lessonId: record.lesson_id,
    status: record.status,
    bestScore: record.best_score,
    bestStarCount: record.best_star_count,
    attemptCount: record.attempt_count,
    xpAwarded: record.xp_awarded,
    firstStartedAt: timestamp(record.first_started_at),
    lastAttemptedAt: timestamp(record.last_attempted_at),
    clearedAt: timestamp(record.cleared_at),
  });
}

function newRemoteProgress(
  userId: string,
  lesson: StoredLesson,
  status: LessonProgress['status'],
): RemoteProgressWrite {
  return {
    user_id: userId,
    lesson_id: lesson.id,
    status,
    best_score: 0,
    best_star_count: 0,
    attempt_count: 0,
    xp_awarded: 0,
    first_started_at: null,
    last_attempted_at: null,
    cleared_at: null,
  };
}

async function readProgress(userId: string): Promise<LessonProgress[]> {
  const { data, error } = await getSupabaseClient()
    .from('lesson_progress')
    .select(progressColumns)
    .eq('user_id', userId);
  if (error) throw new Error('Unable to load online lesson progress.');
  return (data ?? []).map(toLessonProgress);
}

export async function ensureOnlineLessonProgress(
  database: AltrasDatabase,
  userId: string,
): Promise<LessonProgress[]> {
  assertParticipantLearningAccess();
  const lessons = await database.lessons.orderBy('[unitId+displayOrder]').toArray();
  const existing = await readProgress(userId);
  const byLessonId = new Map(existing.map((progress) => [progress.lessonId, progress]));
  const changes: ReturnType<typeof newRemoteProgress>[] = [];

  for (const lesson of lessons) {
    const current = byLessonId.get(lesson.id);
    const prerequisiteCleared = lesson.prerequisiteLessonId
      ? byLessonId.get(lesson.prerequisiteLessonId)?.status === 'cleared'
      : true;

    if (!current) {
      const created = newRemoteProgress(
        userId,
        lesson,
        prerequisiteCleared ? 'available' : 'locked',
      );
      changes.push(created);
      byLessonId.set(lesson.id, toLessonProgress(created));
    } else if (current.status === 'locked' && prerequisiteCleared) {
      changes.push({
        ...newRemoteProgress(userId, lesson, 'available'),
        best_score: current.bestScore,
        best_star_count: current.bestStarCount,
        attempt_count: current.attemptCount,
        xp_awarded: current.xpAwarded,
        first_started_at: current.firstStartedAt
          ? new Date(current.firstStartedAt).toISOString()
          : null,
        last_attempted_at: current.lastAttemptedAt
          ? new Date(current.lastAttemptedAt).toISOString()
          : null,
        cleared_at: current.clearedAt ? new Date(current.clearedAt).toISOString() : null,
      });
    }
  }

  if (changes.length > 0) {
    const { error } = await getSupabaseClient()
      .from('lesson_progress')
      .upsert(changes, { onConflict: 'user_id,lesson_id' });
    if (error) throw new Error('Unable to initialize online lesson progress.');
  }

  return readProgress(userId);
}

export async function getOnlineLessonProgress(
  database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonProgress> {
  await ensureOnlineLessonProgress(database, userId);
  const { data, error } = await getSupabaseClient()
    .from('lesson_progress')
    .select(progressColumns)
    .eq('user_id', userId)
    .eq('lesson_id', lessonId)
    .single();
  if (error) throw new Error('Unable to load this lesson’s online progress.');
  return toLessonProgress(data);
}

export async function getOnlineLessonHubData(
  database: AltrasDatabase,
  userId: string,
): Promise<LessonHubData> {
  const progressRecords = await ensureOnlineLessonProgress(database, userId);
  const [section, unit, lessons] = await Promise.all([
    database.sections.orderBy('displayOrder').first(),
    database.units.orderBy('[sectionId+displayOrder]').first(),
    getAllLessons(database),
  ]);
  if (!section || !unit) throw new Error('The lesson catalog is unavailable.');
  const progressByLesson = new Map(progressRecords.map((record) => [record.lessonId, record]));
  return {
    section,
    unit,
    entries: lessons.map((lesson) => ({
      lesson,
      progress: lessonProgressSchema.parse(progressByLesson.get(lesson.id)),
    })),
  };
}

export async function getOnlineTotalXp(userId: string): Promise<number> {
  return (await readProgress(userId)).reduce((total, record) => total + record.xpAwarded, 0);
}
