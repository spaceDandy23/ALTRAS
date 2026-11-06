import type { AuthoredActivity, LessonActivity } from './content.schemas';

export type ActivityAnswer = string | string[];

export function evaluateActivity(activity: LessonActivity | AuthoredActivity, answer: ActivityAnswer): boolean {
  if (activity.type === 'find-word') {
    return typeof answer === 'string' && answer === activity.correctChoiceId;
  }

  if (activity.type === 'choose-correct-translation') {
    return typeof answer === 'string' && answer === activity.correctChoiceId;
  }

  const acceptedSequences =
    ('acceptedTokenSequences' in activity && activity.acceptedTokenSequences) ||
    (activity.correctTokenSequence ? [activity.correctTokenSequence] : []);
  return Array.isArray(answer) && acceptedSequences.some(
    (sequence) => answer.length === sequence.length && answer.every((tokenId, index) => tokenId === sequence[index]),
  );
}
