import type { LearningLesson, LessonActivity } from '@/features/lessons/domain/content.schemas';
import { getCharacter } from './character.manifest';
import type { CharacterDialogueEvent } from './character.types';

export function resolveCharacterDialogue(
  event: CharacterDialogueEvent,
  options: { characterId?: string; override?: string } = {},
): string {
  const override = options.override?.trim();
  return override || getCharacter(options.characterId).defaultDialogue[event];
}

export function resolveLessonCharacterDialogue(
  lesson: LearningLesson,
  event: 'lesson-introduction' | 'lesson-completion' | 'lesson-passed' | 'lesson-not-passed',
): string {
  const override =
    event === 'lesson-introduction'
      ? lesson.characterDialogue?.introduction
      : lesson.characterDialogue?.completion;
  return resolveCharacterDialogue(event, { characterId: lesson.characterId, override });
}

const activityDialogueField = {
  'activity-introduction': 'introduction',
  'hint-request': 'hint',
  'correct-answer': 'correct',
  'incorrect-answer': 'incorrect',
  encouragement: 'encouragement',
} as const;

export type ActivityCharacterDialogueEvent = keyof typeof activityDialogueField;

export function resolveActivityCharacterDialogue(
  activity: LessonActivity,
  event: ActivityCharacterDialogueEvent,
  characterId?: string,
): string {
  return resolveCharacterDialogue(event, {
    characterId,
    override: activity.characterDialogue?.[activityDialogueField[event]],
  });
}
