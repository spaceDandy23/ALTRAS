export const characterStates = [
  'idle',
  'greeting',
  'explaining',
  'thinking',
  'hint',
  'correct',
  'incorrect',
  'encouraging',
  'celebrating',
  'neutral',
] as const;

export type CharacterState = (typeof characterStates)[number];

export const characterDialogueEvents = [
  'main-menu-greeting',
  'lesson-introduction',
  'activity-introduction',
  'hint-request',
  'correct-answer',
  'incorrect-answer',
  'encouragement',
  'lesson-completion',
  'lesson-passed',
  'lesson-not-passed',
  'assessment-introduction',
  'assessment-completion',
  'resource-introduction',
] as const;

export type CharacterDialogueEvent = (typeof characterDialogueEvents)[number];

export const characterSoundEvents = [
  'greeting',
  'hint',
  'correct',
  'incorrect',
  'celebrate',
] as const;

export type CharacterSoundEvent = (typeof characterSoundEvents)[number];

export type CharacterAssetStatus = 'placeholder' | 'final';
export type CharacterPresentation = 'compact' | 'overview' | 'activity' | 'result' | 'inline';
export type CharacterAnnouncement = 'off' | 'polite' | 'assertive';

export interface CharacterSourceMetadata {
  assetName: string;
  sourceUrl: string;
  creator: string;
  license: string;
  downloadedAt: string;
}

export interface CharacterDefinition {
  id: string;
  displayName: string;
  description: string;
  assetStatus: CharacterAssetStatus;
  source: CharacterSourceMetadata;
  poses: Partial<Record<CharacterState, string>>;
  supportedStates: CharacterState[];
  defaultDialogue: Record<CharacterDialogueEvent, string>;
  soundCues: Partial<Record<CharacterState, CharacterSoundEvent>>;
}
