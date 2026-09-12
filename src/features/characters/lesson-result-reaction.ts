import type { CharacterState } from './character.types';

export function resolveLessonResultReaction(cleared: boolean): {
  state: CharacterState;
  dialogueEvent: 'lesson-passed' | 'lesson-not-passed';
} {
  return cleared
    ? { state: 'celebrating', dialogueEvent: 'lesson-passed' }
    : { state: 'encouraging', dialogueEvent: 'lesson-not-passed' };
}
