import type { AltrasDatabase } from '@/db/database';
import { isSupabaseConfigured } from '@/services/supabase.client';
import { getLesson } from '../content/content.service';
import { evaluateActivity, type ActivityAnswer } from '../domain/evaluation';
import {
  calculateLessonXp,
  calculateScore,
  calculateStars,
  isPassingScore,
} from '../domain/policy';
import { ensureUserLessonProgress, getLessonProgress } from '../progress/progress.service';
import {
  lessonAttemptSchema,
  lessonProgressSchema,
  submittedActivityAnswerSchema,
  type LessonAttempt,
} from '@/types/learning';
import { AttemptError } from './attempt.errors';
import {
  completeOnlineAttempt,
  getOnlineActiveAttempt,
  getOnlineAttempt,
  recordOnlineActiveSeconds,
  restartOnlineAttempt,
  startOrResumeOnlineAttempt,
  submitOnlineActivityAnswer,
} from './online-attempt.service';

export { AttemptError } from './attempt.errors';

function newAttempt(userId: string, lessonId: string, contentVersion: number): LessonAttempt {
  const now = Date.now();
  return lessonAttemptSchema.parse({
    id: crypto.randomUUID(),
    userId,
    lessonId,
    contentVersion,
    status: 'active',
    startedAt: now,
    lastUpdatedAt: now,
    completedAt: null,
    abandonedAt: null,
    answers: [],
    finalScore: null,
    starCount: null,
    cleared: null,
    xpImprovement: 0,
  });
}

export async function getActiveAttempt(
  database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonAttempt | null> {
  if (isSupabaseConfigured) return getOnlineActiveAttempt(userId, lessonId);
  const attempts = await database.lessonAttempts
    .where('[userId+lessonId]')
    .equals([userId, lessonId])
    .filter((attempt) => attempt.status === 'active')
    .sortBy('lastUpdatedAt');
  return attempts.length > 0 ? lessonAttemptSchema.parse(attempts.at(-1)) : null;
}

export async function startOrResumeAttempt(
  database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonAttempt> {
  if (isSupabaseConfigured) return startOrResumeOnlineAttempt(database, userId, lessonId);
  const lesson = await getLesson(database, lessonId);
  if (lesson.contentStatus !== 'playable') throw new AttemptError('This lesson is a preview.');
  const progress = await getLessonProgress(database, userId, lessonId);
  if (progress.status === 'locked') throw new AttemptError('Clear the prerequisite lesson first.');
  const active = await getActiveAttempt(database, userId, lessonId);
  if (active) return active;

  const attempt = newAttempt(userId, lessonId, lesson.contentVersion);
  const now = Date.now();
  await database.transaction('rw', [database.lessonAttempts, database.lessonProgress], async () => {
    const existingActive = await getActiveAttempt(database, userId, lessonId);
    if (existingActive) return;
    await database.lessonAttempts.add(attempt);
    await database.lessonProgress.put(
      lessonProgressSchema.parse({
        ...progress,
        status: progress.status === 'cleared' ? 'cleared' : 'in-progress',
        firstStartedAt: progress.firstStartedAt ?? now,
      }),
    );
  });
  return (await getActiveAttempt(database, userId, lessonId)) ?? attempt;
}

export async function restartAttempt(
  database: AltrasDatabase,
  userId: string,
  lessonId: string,
): Promise<LessonAttempt> {
  if (isSupabaseConfigured) return restartOnlineAttempt(database, userId, lessonId);
  const lesson = await getLesson(database, lessonId);
  const progress = await getLessonProgress(database, userId, lessonId);
  if (progress.status === 'locked') throw new AttemptError('Clear the prerequisite lesson first.');
  const next = newAttempt(userId, lessonId, lesson.contentVersion);
  const now = Date.now();

  await database.transaction('rw', database.lessonAttempts, async () => {
    const activeAttempts = await database.lessonAttempts
      .where('[userId+lessonId]')
      .equals([userId, lessonId])
      .filter((attempt) => attempt.status === 'active')
      .toArray();
    await Promise.all(
      activeAttempts.map((attempt) =>
        database.lessonAttempts.put({
          ...attempt,
          status: 'abandoned',
          abandonedAt: now,
          lastUpdatedAt: now,
        }),
      ),
    );
    await database.lessonAttempts.add(next);
  });
  return next;
}

export async function submitActivityAnswer(
  database: AltrasDatabase,
  attemptId: string,
  activityId: string,
  answer: ActivityAnswer,
  currentAttempt?: LessonAttempt,
): Promise<LessonAttempt> {
  if (isSupabaseConfigured) {
    return submitOnlineActivityAnswer(database, attemptId, activityId, answer, currentAttempt);
  }
  const initialAttempt = lessonAttemptSchema.parse(await database.lessonAttempts.get(attemptId));
  const lesson = await getLesson(database, initialAttempt.lessonId);
  const activity = lesson.activities.find((candidate) => candidate.id === activityId);
  if (!activity) throw new AttemptError('This activity is not part of the lesson.');

  return database.transaction('rw', database.lessonAttempts, async () => {
    const attempt = lessonAttemptSchema.parse(await database.lessonAttempts.get(attemptId));
    if (attempt.status !== 'active') throw new AttemptError('This attempt is already closed.');
    if (attempt.answers.some((submitted) => submitted.activityId === activityId)) return attempt;

    const submitted = submittedActivityAnswerSchema.parse({
      activityId,
      activityType: activity.type,
      answer,
      isCorrect: evaluateActivity(activity, answer),
      submittedAt: Date.now(),
    });
    const updated = lessonAttemptSchema.parse({
      ...attempt,
      answers: [...attempt.answers, submitted],
      lastUpdatedAt: submitted.submittedAt,
    });
    await database.lessonAttempts.put(updated);
    return updated;
  });
}

export async function completeAttempt(
  database: AltrasDatabase,
  attemptId: string,
): Promise<LessonAttempt> {
  if (isSupabaseConfigured) return completeOnlineAttempt(database, attemptId);
  const initialAttempt = lessonAttemptSchema.parse(await database.lessonAttempts.get(attemptId));
  if (initialAttempt.status === 'completed') return initialAttempt;
  const lesson = await getLesson(database, initialAttempt.lessonId);
  if (initialAttempt.answers.length !== lesson.activities.length) {
    throw new AttemptError('Complete every activity before finishing the lesson.');
  }

  return database.transaction(
    'rw',
    [database.lessonAttempts, database.lessonProgress, database.lessons],
    async () => {
      const attempt = lessonAttemptSchema.parse(await database.lessonAttempts.get(attemptId));
      if (attempt.status === 'completed') return attempt;
      if (attempt.status !== 'active') throw new AttemptError('This attempt cannot be completed.');

      const correctCount = attempt.answers.filter((answer) => answer.isCorrect).length;
      const finalScore = calculateScore(correctCount, lesson.activities.length);
      const starCount = calculateStars(finalScore);
      const cleared = isPassingScore(finalScore, lesson.passingThreshold);
      const now = Date.now();
      const progress = lessonProgressSchema.parse(
        await database.lessonProgress.get(`${attempt.userId}:${attempt.lessonId}`),
      );
      const bestScore = Math.max(progress.bestScore, finalScore);
      const bestStarCount = Math.max(progress.bestStarCount, starCount);
      const nextXp = calculateLessonXp(bestScore, bestStarCount);
      const xpImprovement = Math.max(0, nextXp - progress.xpAwarded);
      const wasAlreadyCleared = progress.status === 'cleared';

      const completed = lessonAttemptSchema.parse({
        ...attempt,
        status: 'completed',
        completedAt: now,
        lastUpdatedAt: now,
        finalScore,
        starCount,
        cleared,
        xpImprovement,
      });
      const nextProgress = lessonProgressSchema.parse({
        ...progress,
        status: cleared || wasAlreadyCleared ? 'cleared' : 'available',
        bestScore,
        bestStarCount,
        attemptCount: progress.attemptCount + 1,
        xpAwarded: nextXp,
        lastAttemptedAt: now,
        clearedAt: progress.clearedAt ?? (cleared ? now : null),
      });

      await database.lessonAttempts.put(completed);
      await database.lessonProgress.put(nextProgress);

      if (cleared) {
        const followUps = await database.lessons
          .where('prerequisiteLessonId')
          .equals(lesson.id)
          .toArray();
        for (const followUp of followUps) {
          const id = `${attempt.userId}:${followUp.id}`;
          const existing = await database.lessonProgress.get(id);
          if (!existing) {
            await database.lessonProgress.put(
              lessonProgressSchema.parse({
                id,
                userId: attempt.userId,
                lessonId: followUp.id,
                status: 'available',
                bestScore: 0,
                bestStarCount: 0,
                attemptCount: 0,
                xpAwarded: 0,
                firstStartedAt: null,
                lastAttemptedAt: null,
                clearedAt: null,
              }),
            );
          } else if (existing.status === 'locked') {
            await database.lessonProgress.put({ ...existing, status: 'available' });
          }
        }
      }
      return completed;
    },
  );
}

export async function getAttempt(
  database: AltrasDatabase,
  userId: string,
  attemptId: string,
): Promise<LessonAttempt> {
  if (isSupabaseConfigured) return getOnlineAttempt(userId, attemptId);
  const attempt = lessonAttemptSchema.parse(await database.lessonAttempts.get(attemptId));
  if (attempt.userId !== userId) throw new AttemptError('This attempt belongs to another account.');
  return attempt;
}

export async function ensureLearningReady(database: AltrasDatabase, userId: string): Promise<void> {
  await ensureUserLessonProgress(database, userId);
}

export async function recordAttemptActiveSeconds(
  _database: AltrasDatabase,
  attemptId: string,
  seconds: number,
): Promise<void> {
  if (isSupabaseConfigured) await recordOnlineActiveSeconds(attemptId, seconds);
}
