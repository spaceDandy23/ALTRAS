import { describe, expect, it } from 'vitest';
import { packagedContent } from '../content/packaged-content';
import { activitySchema, packagedContentSchema, publicActivitySchema } from './content.schemas';

describe('learning content schema', () => {
  it('accepts the bundled unit and all supported activity types', () => {
    const parsed = packagedContentSchema.parse(packagedContent);
    const playable = parsed.lessons.find((lesson) => lesson.contentStatus === 'playable');

    expect(playable?.activities).toHaveLength(6);
    expect(playable?.activities.filter((activity) => activity.type === 'find-word')).toHaveLength(
      3,
    );
    expect(
      playable?.activities.filter((activity) => activity.type === 'organize-translate'),
    ).toHaveLength(3);
  });

  it('accepts a choice-based verbal phrase translation without exposing its answer key', () => {
    const activity = {
      id: 'translate-sum-five',
      type: 'choose-correct-translation',
      title: 'Choose the matching expression',
      prompt: 'The sum of a number and five',
      choices: [
        { id: 'choice-a', label: 'n + 5' },
        { id: 'choice-b', label: 'n - 5' },
      ],
      correctChoiceId: 'choice-a',
      explanation: { title: 'Addition', body: 'Sum means add.' },
    };

    expect(activitySchema.safeParse(activity).success).toBe(true);
    const { correctChoiceId: answerKey, ...publicFields } = activity;
    void answerKey;
    expect(publicActivitySchema.parse(publicFields)).not.toHaveProperty('correctChoiceId');
  });

  it('accepts lesson activities with no authored explanation', () => {
    const activity = structuredClone(packagedContent.lessons[0].activities[0]);
    delete activity.explanation;
    expect(activitySchema.parse(activity)).not.toHaveProperty('explanation');
  });

  it('provides five stable, supported Order Matters activities and verified examples', () => {
    const lesson = packagedContent.lessons.find(
      (candidate) => candidate.id === 'lesson-order-matters',
    );

    expect(lesson).toMatchObject({
      title: 'Order Matters',
      contentStatus: 'playable',
      contentVersion: 2,
      passingThreshold: 70,
    });
    expect(lesson?.activities).toHaveLength(5);
    expect(lesson?.activities.map((activity) => activity.id)).toEqual([
      'order-find-less-than',
      'order-find-subtracted-from',
      'order-organize-less-than',
      'order-organize-subtracted-from',
      'order-organize-more-than',
    ]);
    expect(new Set(lesson?.activities.map((activity) => activity.type))).toEqual(
      new Set(['find-word', 'organize-translate']),
    );
    expect(
      lesson?.instructionalContent
        .filter((block) => block.type === 'example')
        .map((block) => [block.phrase, block.expression]),
    ).toEqual([
      ['six less than a number', 'n − 6'],
      ['a number subtracted from twelve', '12 − n'],
      ['four more than twice a number', '2n + 4'],
      ['the difference of twelve and a number', '12 − n'],
    ]);
  });

  it('rejects invalid relationships and incorrect activity answers', () => {
    const invalid = structuredClone(packagedContent);
    invalid.lessons[0].unitId = 'missing-unit';
    const activity = invalid.lessons[0].activities[0];
    if (activity.type === 'find-word') activity.correctChoiceId = 'not-a-choice';

    expect(packagedContentSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts optional reusable character dialogue without requiring it in existing lessons', () => {
    const withGuidance = structuredClone(packagedContent);
    withGuidance.lessons[0].characterId = 'altras-guide';
    withGuidance.lessons[0].characterDialogue = {
      introduction: 'Lesson introduction override.',
      completion: 'Lesson completion override.',
    };
    withGuidance.lessons[0].activities[0].characterDialogue = {
      introduction: 'Activity introduction override.',
      hint: 'Hint override.',
      correct: 'Correct override.',
      incorrect: 'Incorrect override.',
      encouragement: 'Encouragement override.',
    };

    const parsed = packagedContentSchema.parse(withGuidance);
    expect(parsed.lessons[0]).toMatchObject({
      characterId: 'altras-guide',
      characterDialogue: { introduction: 'Lesson introduction override.' },
    });
    expect(parsed.lessons[0].activities[0].characterDialogue).toMatchObject({
      hint: 'Hint override.',
      correct: 'Correct override.',
    });
    expect(packagedContentSchema.safeParse(packagedContent).success).toBe(true);
  });

  it('rejects blank character dialogue overrides', () => {
    const invalid = structuredClone(packagedContent);
    invalid.lessons[0].characterDialogue = { introduction: '   ' };
    expect(packagedContentSchema.safeParse(invalid).success).toBe(false);
  });
});
