import { describe, expect, it } from 'vitest';
import { packagedContent } from '../content/packaged-content';
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
        activity.type === 'find-word' ? activity.correctChoiceId : activity.correctTokenSequence;
      const incorrectAnswer =
        activity.type === 'find-word'
          ? activity.choices.find((choice) => choice.id !== activity.correctChoiceId)?.id
          : [...activity.correctTokenSequence].reverse();

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
});
