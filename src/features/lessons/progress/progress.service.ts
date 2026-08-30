import type { AltrasDatabase } from '@/db/database';
import { getAllLessons } from '../content/content.service';
import { lessonProgressSchema, type LessonProgress, type StoredLesson } from '@/types/learning';
import type { LearningLesson, LearningSection, LearningUnit } from '../domain/content.schemas';
import { isSupabaseConfigured } from '@/services/supabase.client';
import {
  ensureOnlineLessonProgress,
  getOnlineLessonHubData,
  getOnlineLessonProgress,
  getOnlineTotalXp,
} from './online-progress.service';

export interface LessonHubEntry {
  lesson: LearningLesson;
  progress: LessonProgress;
}

export interface LessonHubData {
  section: LearningSection;
  unit: LearningUnit;
  entries: LessonHubEntry[];
}

function createProgress(userId: string, lesson: StoredLesson, status: LessonProgress['status']) {
  return lessonProgressSchema.parse({
    id: `${userId}:${lesson.id}`,
    userId,
    lessonId: lesson.id,
    status,
    bestScore: 0,
    bestStarCount: 0,
    attemptCount: 0,
    xpAwarded: 0,
    firstStartedAt: null,
    lastAttemptedAt: null,
    clearedAt: null,
  });
}

export async function ensureUserLessonProgress(
  database: AltrasDatabase,
  userId: string,
): Promise<LessonProgress[]> {
  if (isSupabaseConfigured) return ensureOnlineLessonProgress(database, userId);

  const lessons = await database.lessons.orderBy('[unitId+displayOrder]').toArray();
  const existing = await database.lessonProgress.where('userId').equals(userId).toArray();
  const byLessonId = new Map(existing.map((progress) => [progress.lessonId, progress]));
  const nextRecords: LessonProgress[] = [];

  for (const lesson of lessons) {
    const current = byLessonId.get(lesson.id);
    const prerequisiteCleared = lesson.prerequisiteLessonId
      ? byLessonId.get(lesson.prerequisiteLessonId)?.status === 'cleared'
      : true;

    if (!current) {
      const created = createProgress(userId, lesson, prerequisiteCleared ? 'available' : 'locked');
      byLessonId.set(lesson.id, created);
      nextRecords.push(created);
    } else if (current.status === 'locked' && prerequisiteCleared) {
      const unlocked = lessonProgressSchema.parse({ ...current, status: 'available' });
      byLessonId.set(lesson.id, unlocked);
      nextRecords.push(unlocked);
    }
  }

  if (nextRecords.length > 0) await database.lessonProgress.bulkPut(nextRecords);
  return database.lessonProgress.where('userId').equals(userId).toArray();
}

export async function getLessonProgress(
  database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonProgress> {
  if (isSupabaseConfigured) return getOnlineLessonProgress(database, userId, lessonId);

  await ensureUserLessonProgress(database, userId);
  return lessonProgressSchema.parse(await database.lessonProgress.get(`${userId}:${lessonId}`));
}

export async function getLessonHubData(
  database: AltrasDatabase,
  userId: string,
): Promise<LessonHubData> {
  if (isSupabaseConfigured) return getOnlineLessonHubData(database, userId);

  await ensureUserLessonProgress(database, userId);
  const [section, unit, lessons, progressRecords] = await Promise.all([
    database.sections.orderBy('displayOrder').first(),
    database.units.orderBy('[sectionId+displayOrder]').first(),
    getAllLessons(database),
    database.lessonProgress.where('userId').equals(userId).toArray(),
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

export async function getTotalXp(database: AltrasDatabase, userId: string): Promise<number> {
  if (isSupabaseConfigured) return getOnlineTotalXp(userId);
  const progress = await database.lessonProgress.where('userId').equals(userId).toArray();
  return progress.reduce((total, record) => total + record.xpAwarded, 0);
}
