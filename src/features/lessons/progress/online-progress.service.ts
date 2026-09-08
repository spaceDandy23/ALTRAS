import { z } from 'zod';
import type { AltrasDatabase } from '@/db/database';
import { getSupabaseClient } from '@/services/supabase.client';
import { assertParticipantLearningAccess } from '@/stores/researcher-access.store';
import { lessonProgressSchema, type LessonProgress } from '@/types/learning';
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
  _userId: string,
): Promise<LessonProgress[]> {
  assertParticipantLearningAccess();
  const lessons = await database.lessons.orderBy('[unitId+displayOrder]').toArray();
  const { data, error } = await getSupabaseClient().rpc('initialize_lesson_progress');
  if (error) throw new Error('Unable to initialize online lesson progress.');
  const existing = z
    .array(remoteProgressSchema)
    .parse(data ?? [])
    .map(toLessonProgress);
  const byLessonId = new Map(existing.map((progress) => [progress.lessonId, progress]));

  return lessons.flatMap((lesson) => {
    const progress = byLessonId.get(lesson.id);
    return progress ? [progress] : [];
  });
}

export async function getOnlineLessonProgress(
  database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonProgress> {
  const progress = (await ensureOnlineLessonProgress(database, userId)).find(
    (record) => record.lessonId === lessonId,
  );
  if (!progress) throw new Error('Unable to load this lesson’s online progress.');
  return progress;
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
