import type { LessonActivity } from './content.schemas';

export type ActivityAnswer = string | string[];

export function evaluateActivity(activity: LessonActivity, answer: ActivityAnswer): boolean {
  if (activity.type === 'find-word') {
    return typeof answer === 'string' && answer === activity.correctChoiceId;
  }

  return (
    Array.isArray(answer) &&
    answer.length === activity.correctTokenSequence.length &&
    answer.every((tokenId, index) => tokenId === activity.correctTokenSequence[index])
  );
}
