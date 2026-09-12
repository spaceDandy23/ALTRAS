import type { AltrasDatabase } from '@/db/database';
import type { LessonAttempt } from '@/types/learning';
import type { ActivityAnswer } from '../domain/evaluation';
import type { LessonAttemptLaunchMode } from './attempt-launch';
import { ensureUserLessonProgress } from '../progress/progress.service';
import {
  completeOnlineAttempt,
  getOnlineActiveAttempt,
  getOnlineAttempt,
  prepareOnlineAttempt,
  recordOnlineActiveSeconds,
  restartOnlineAttempt,
  submitOnlineActivityAnswer,
} from './online-attempt.service';

export type { LessonAttemptLaunchMode } from './attempt-launch';

export { AttemptError } from './attempt.errors';

const pendingLaunchModes = new Map<string, LessonAttemptLaunchMode>();

export async function getActiveAttempt(
  _database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonAttempt | null> {
  return getOnlineActiveAttempt(userId, lessonId);
}

export async function startOrResumeAttempt(
  database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonAttempt> {
  const launch = await prepareOnlineAttempt(database, userId, lessonId);
  pendingLaunchModes.set(launch.attempt.id, launch.mode);
  return launch.attempt;
}

export function consumeLessonAttemptLaunchMode(attemptId: string) {
  const mode = pendingLaunchModes.get(attemptId) ?? 'resume';
  pendingLaunchModes.delete(attemptId);
  return mode;
}

export async function restartAttempt(
  database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonAttempt> {
  const attempt = await restartOnlineAttempt(database, userId, lessonId);
  pendingLaunchModes.set(attempt.id, 'retry');
  return attempt;
}

export async function submitActivityAnswer(
  database: AltrasDatabase,
  attemptId: string,
  activityId: string,
  answer: ActivityAnswer,
  currentAttempt?: LessonAttempt,
): Promise<LessonAttempt> {
  return submitOnlineActivityAnswer(database, attemptId, activityId, answer, currentAttempt);
}

export async function completeAttempt(
  database: AltrasDatabase,
  attemptId: string,
): Promise<LessonAttempt> {
  return completeOnlineAttempt(database, attemptId);
}

export async function getAttempt(
  _database: AltrasDatabase,
  userId: string,
  attemptId: string,
): Promise<LessonAttempt> {
  return getOnlineAttempt(userId, attemptId);
}

export async function ensureLearningReady(database: AltrasDatabase, userId: string): Promise<void> {
  await ensureUserLessonProgress(database, userId);
}

export async function recordAttemptActiveSeconds(
  _database: AltrasDatabase,
  attemptId: string,
  seconds: number,
): Promise<void> {
  await recordOnlineActiveSeconds(attemptId, seconds);
}
