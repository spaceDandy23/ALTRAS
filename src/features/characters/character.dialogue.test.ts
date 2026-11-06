import { describe, expect, it } from 'vitest';
import { packagedContent } from '@/features/lessons/content/packaged-content';
import { lessonSchema } from '@/features/lessons/domain/content.schemas';
import {
  resolveActivityCharacterDialogue,
  resolveCharacterDialogue,
  resolveLessonCharacterDialogue,
} from './character.dialogue';
import { characterDialogueEvents } from './character.types';

describe('character dialogue', () => {
  it('provides deterministic fallback dialogue for every semantic event', () => {
    for (const event of characterDialogueEvents) {
      const first = resolveCharacterDialogue(event);
      expect(first.length).toBeGreaterThan(0);
      expect(resolveCharacterDialogue(event)).toBe(first);
    }
  });

  it('prefers lesson-specific introduction and completion dialogue', () => {
    const lesson = lessonSchema.parse({
      ...structuredClone(packagedContent.lessons[0]),
      characterId: 'altras-guide',
      characterDialogue: {
        introduction: 'Custom lesson introduction.',
        completion: 'Custom lesson completion.',
      },
    });

    expect(resolveLessonCharacterDialogue(lesson, 'lesson-introduction')).toBe(
      'Custom lesson introduction.',
    );
    expect(resolveLessonCharacterDialogue(lesson, 'lesson-passed')).toBe(
      'Custom lesson completion.',
    );
    expect(resolveLessonCharacterDialogue(lesson, 'lesson-not-passed')).toBe(
      'Custom lesson completion.',
    );
  });

  it('prefers activity-specific dialogue and safely falls back for blank overrides', () => {
    const activity = lessonSchema.parse({
      ...structuredClone(packagedContent.lessons[0]),
      activities: [
        {
          ...structuredClone(packagedContent.lessons[0].activities[0]),
          characterDialogue: {
            introduction: 'Custom activity introduction.',
            hint: 'Custom hint guidance.',
            correct: 'Custom correct reaction.',
            incorrect: 'Custom incorrect reaction.',
            encouragement: 'Custom encouragement.',
          },
        },
      ],
    }).activities[0];

    expect(resolveActivityCharacterDialogue(activity, 'activity-introduction')).toBe(
      'Custom activity introduction.',
    );
    expect(resolveActivityCharacterDialogue(activity, 'hint-request')).toBe(
      'Custom hint guidance.',
    );
    expect(resolveActivityCharacterDialogue(activity, 'correct-answer')).toBe(
      'Custom correct reaction.',
    );
    expect(resolveActivityCharacterDialogue(activity, 'incorrect-answer')).toBe(
      'Custom incorrect reaction.',
    );
    expect(resolveActivityCharacterDialogue(activity, 'encouragement')).toBe(
      'Custom encouragement.',
    );
    expect(resolveCharacterDialogue('hint-request', { override: '   ' })).toBe(
      resolveCharacterDialogue('hint-request'),
    );
  });
});
