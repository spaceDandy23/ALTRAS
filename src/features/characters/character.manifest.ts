import { z } from 'zod';
import {
  characterDialogueEvents,
  characterSoundEvents,
  characterStates,
  type CharacterDefinition,
  type CharacterSoundEvent,
  type CharacterState,
} from './character.types';

export const DEFAULT_CHARACTER_ID = 'altras-guide';

const characterStateSchema = z.enum(characterStates);
const characterDialogueEventSchema = z.enum(characterDialogueEvents);
const characterSoundEventSchema = z.enum(characterSoundEvents);
const characterAssetPathSchema = z.string().startsWith('/assets/characters/');

export const characterDefinitionSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().min(1),
    assetStatus: z.enum(['placeholder', 'final']),
    source: z.object({
      assetName: z.string().min(1),
      sourceUrl: z.string().url(),
      creator: z.string().min(1),
      license: z.string().min(1),
      downloadedAt: z.iso.date(),
    }),
    poses: z.partialRecord(characterStateSchema, characterAssetPathSchema),
    supportedStates: z.array(characterStateSchema).min(1),
    defaultDialogue: z.record(characterDialogueEventSchema, z.string().trim().min(1)),
    soundCues: z.partialRecord(characterStateSchema, characterSoundEventSchema),
  })
  .superRefine((character, context) => {
    if (!character.poses.neutral && !character.poses.idle) {
      context.addIssue({
        code: 'custom',
        path: ['poses'],
        message: 'A character requires a neutral or idle fallback pose.',
      });
    }
    for (const state of character.supportedStates) {
      if (!character.poses[state] && !character.poses.neutral && !character.poses.idle) {
        context.addIssue({
          code: 'custom',
          path: ['supportedStates'],
          message: `State ${state} has no safe pose fallback.`,
        });
      }
    }
  });

export const characterManifestSchema = z
  .record(z.string().min(1), characterDefinitionSchema)
  .superRefine((manifest, context) => {
    for (const [key, character] of Object.entries(manifest)) {
      if (key !== character.id) {
        context.addIssue({
          code: 'custom',
          path: [key, 'id'],
          message: 'Character manifest keys must match their stable IDs.',
        });
      }
    }
    if (!manifest[DEFAULT_CHARACTER_ID]) {
      context.addIssue({ code: 'custom', message: 'The default character is missing.' });
    }
  });

const placeholderDirectory = '/assets/characters/placeholder';

const manifest = {
  [DEFAULT_CHARACTER_ID]: {
    id: DEFAULT_CHARACTER_ID,
    displayName: 'Mina',
    description: 'Temporary ALTRAS learning companion using the Kenney Female person character.',
    assetStatus: 'placeholder',
    source: {
      assetName: 'Female person — Toon Characters',
      sourceUrl: 'https://kenney.nl/assets/toon-characters',
      creator: 'Kenney',
      license: 'CC0 1.0',
      downloadedAt: '2026-09-01',
    },
    poses: {
      idle: `${placeholderDirectory}/female-person-idle.png`,
      neutral: `${placeholderDirectory}/female-person-idle.png`,
      greeting: `${placeholderDirectory}/female-person-talk.png`,
      explaining: `${placeholderDirectory}/female-person-talk.png`,
      thinking: `${placeholderDirectory}/female-person-think.png`,
      hint: `${placeholderDirectory}/female-person-think.png`,
      correct: `${placeholderDirectory}/female-person-cheer.png`,
      celebrating: `${placeholderDirectory}/female-person-cheer.png`,
      incorrect: `${placeholderDirectory}/female-person-incorrect.png`,
      encouraging: `${placeholderDirectory}/female-person-encouraging.png`,
    },
    supportedStates: [...characterStates],
    defaultDialogue: {
      'main-menu-greeting':
        'Ready for your next step? Pick up where you left off when you are ready.',
      'lesson-introduction':
        'Start with the lesson goal, then use each example to guide your thinking.',
      'activity-introduction':
        'Read the words carefully and decide what the expression is telling you.',
      'hint-request': 'Use the hint as a clue, then make the final choice yourself.',
      'correct-answer': 'Nice work. Your answer matches the mathematical meaning.',
      'incorrect-answer': 'Not quite. Compare your answer with the explanation before continuing.',
      encouragement: 'Keep going. One careful step at a time is how this gets easier.',
      'lesson-completion': 'You reached the end of this lesson attempt.',
      'lesson-passed': 'Lesson cleared! Your careful reading paid off.',
      'lesson-not-passed':
        'This attempt is saved. Review the feedback and try again when you are ready.',
      'assessment-introduction':
        'Take your time and choose the answer that best matches what you know.',
      'assessment-question': 'Choose the answer that best matches the phrase.',
      'assessment-completion': 'Your assessment is complete and your score has been saved.',
      'resource-introduction':
        'Use this reference whenever an operation word or phrase feels unfamiliar.',
    },
    soundCues: {
      greeting: 'greeting',
      hint: 'hint',
      correct: 'correct',
      incorrect: 'incorrect',
      celebrating: 'celebrate',
    },
  },
} satisfies Record<string, CharacterDefinition>;

export const characterManifest = characterManifestSchema.parse(manifest);

export function getCharacter(characterId = DEFAULT_CHARACTER_ID): CharacterDefinition {
  return characterManifest[characterId] ?? characterManifest[DEFAULT_CHARACTER_ID];
}

export function resolvePoseForCharacter(
  character: CharacterDefinition,
  state: CharacterState,
): string {
  return (
    character.poses[state] ??
    character.poses.neutral ??
    character.poses.idle ??
    Object.values(character.poses)[0] ??
    ''
  );
}

export function resolveCharacterPose(characterId: string | undefined, state: CharacterState) {
  return resolvePoseForCharacter(getCharacter(characterId), state);
}

export function resolveCharacterSoundCue(
  characterId: string | undefined,
  state: CharacterState,
): CharacterSoundEvent | null {
  return getCharacter(characterId).soundCues[state] ?? null;
}
