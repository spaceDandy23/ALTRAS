import type { LessonAttempt } from '@/types/learning';
import type { LearningLesson } from './content.schemas';

export function activityResultForAttempt(attempt: LessonAttempt, lesson: LearningLesson) {
  const total = lesson.activities.length;
  if (total === 0) return null;

  const answers = new Map(attempt.answers.map((answer) => [answer.activityId, answer]));
  if (!lesson.activities.every((activity) => answers.has(activity.id))) return null;

  const correct = lesson.activities.filter((activity) => answers.get(activity.id)?.isCorrect).length;
  return { correct, total, percentage: Math.round((correct / total) * 100) };
}
