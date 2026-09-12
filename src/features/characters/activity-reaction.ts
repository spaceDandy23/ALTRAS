import type { SubmittedActivityAnswer } from '@/types/learning';
import type { ActivityCharacterDialogueEvent } from './character.dialogue';
import type { CharacterState } from './character.types';

export interface ActivityReaction {
  state: CharacterState;
  dialogueEvent: ActivityCharacterDialogueEvent;
}

export function resolveActivityCharacterReaction({
  submitted,
  hintVisible,
  encouraging,
}: {
  submitted?: SubmittedActivityAnswer;
  hintVisible: boolean;
  encouraging: boolean;
}): ActivityReaction {
  if (submitted?.isCorrect) return { state: 'correct', dialogueEvent: 'correct-answer' };
  if (submitted && encouraging) {
    return { state: 'encouraging', dialogueEvent: 'encouragement' };
  }
  if (submitted) return { state: 'incorrect', dialogueEvent: 'incorrect-answer' };
  if (hintVisible) return { state: 'hint', dialogueEvent: 'hint-request' };
  return { state: 'explaining', dialogueEvent: 'activity-introduction' };
}
