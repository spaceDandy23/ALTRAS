import { describe, expect, it } from 'vitest';
import { packagedContent } from '../content/packaged-content';
import { activitySchema } from './content.schemas';
import { evaluateActivity } from './evaluation';

const activities = packagedContent.lessons[0].activities;

describe('activity evaluation', () => {
  it('evaluates Find-the-Word by stable choice ID', () => {
    const activity = activities.find((candidate) => candidate.type === 'find-word');
    if (!activity || activity.type !== 'find-word') throw new Error('Missing fixture.');

    expect(evaluateActivity(activity, activity.correctChoiceId)).toBe(true);
    expect(evaluateActivity(activity, 'different-choice')).toBe(false);
  });

  it('evaluates every Order Matters intended answer and rejects an incorrect one', () => {
    const lesson = packagedContent.lessons.find(
      (candidate) => candidate.id === 'lesson-order-matters',
    );
    if (!lesson) throw new Error('Missing Order Matters fixture.');

    for (const activity of lesson.activities) {
      const correctAnswer =
        activity.type === 'organize-translate'
          ? activity.correctTokenSequence
          : activity.correctChoiceId;
      const incorrectAnswer =
        activity.type === 'organize-translate'
          ? [...activity.correctTokenSequence].reverse()
          : activity.choices.find((choice) => choice.id !== activity.correctChoiceId)?.id;

      expect(evaluateActivity(activity, correctAnswer), activity.id).toBe(true);
      expect(evaluateActivity(activity, incorrectAnswer ?? 'incorrect'), activity.id).toBe(false);
    }
  });

  it('evaluates Organize-and-Translate by exact token sequence', () => {
    const activity = activities.find((candidate) => candidate.type === 'organize-translate');
    if (!activity || activity.type !== 'organize-translate') throw new Error('Missing fixture.');

    expect(evaluateActivity(activity, activity.correctTokenSequence)).toBe(true);
    expect(evaluateActivity(activity, [...activity.correctTokenSequence].reverse())).toBe(false);
  });

  it('evaluates Choose-the-Correct-Translation by stable choice ID', () => {
    const activity = activitySchema.parse({
      id: 'choose-translation',
      type: 'choose-correct-translation',
      title: 'Translate the phrase',
      prompt: 'The sum of a number and five',
      choices: [
        { id: 'sum', label: 'n + 5' },
        { id: 'difference', label: 'n - 5' },
      ],
      correctChoiceId: 'sum',
      explanation: { title: 'Sum means addition', body: 'Add five to n.' },
    });

    expect(evaluateActivity(activity, 'sum')).toBe(true);
    expect(evaluateActivity(activity, 'difference')).toBe(false);
    expect(evaluateActivity(activity, ['sum'])).toBe(false);
  });
});
