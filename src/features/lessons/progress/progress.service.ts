import type { AltrasDatabase } from '@/db/database';
import type { LessonProgress } from '@/types/learning';
import type { LearningLesson, LearningSection, LearningUnit } from '../domain/content.schemas';
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

export async function ensureUserLessonProgress(
  database: AltrasDatabase,
  userId: string,
): Promise<LessonProgress[]> {
  return ensureOnlineLessonProgress(database, userId);
}

export async function getLessonProgress(
  database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonProgress> {
  return getOnlineLessonProgress(database, userId, lessonId);
}

export async function getLessonHubData(
  database: AltrasDatabase,
  userId: string,
): Promise<LessonHubData> {
  return getOnlineLessonHubData(database, userId);
}

export async function getTotalXp(database: AltrasDatabase, userId: string): Promise<number> {
  return getOnlineTotalXp(userId);
}
