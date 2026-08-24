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

  it('evaluates Organize-and-Translate by exact token sequence', () => {
    const activity = activities.find((candidate) => candidate.type === 'organize-translate');
    if (!activity || activity.type !== 'organize-translate') throw new Error('Missing fixture.');

    expect(evaluateActivity(activity, activity.correctTokenSequence)).toBe(true);
    expect(evaluateActivity(activity, [...activity.correctTokenSequence].reverse())).toBe(false);
  });
});
