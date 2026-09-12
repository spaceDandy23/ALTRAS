import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  characterDefinitionSchema,
  characterManifest,
  characterManifestSchema,
  DEFAULT_CHARACTER_ID,
  getCharacter,
  resolveCharacterPose,
  resolveCharacterSoundCue,
  resolvePoseForCharacter,
} from './character.manifest';
import { characterStates, type CharacterDefinition } from './character.types';

describe('character manifest', () => {
  it('validates the centralized manifest and required metadata', () => {
    expect(characterManifestSchema.safeParse(characterManifest).success).toBe(true);
    expect(getCharacter()).toMatchObject({
      id: DEFAULT_CHARACTER_ID,
      assetStatus: 'placeholder',
      source: { creator: 'Kenney', license: 'CC0 1.0' },
    });
  });

  it('resolves every semantic state to the intended transparent pose', () => {
    for (const state of characterStates) {
      expect(resolveCharacterPose(DEFAULT_CHARACTER_ID, state)).toMatch(
        /^\/assets\/characters\/placeholder\/.+\.png$/,
      );
    }
    expect(resolveCharacterPose(DEFAULT_CHARACTER_ID, 'explaining')).toContain('talk');
    expect(resolveCharacterPose(DEFAULT_CHARACTER_ID, 'hint')).toContain('think');
    expect(resolveCharacterPose(DEFAULT_CHARACTER_ID, 'correct')).toContain('cheer');
    expect(resolveCharacterPose(DEFAULT_CHARACTER_ID, 'incorrect')).toContain('incorrect');
  });

  it('includes each referenced pose as a transparent PNG asset', () => {
    const posePaths = new Set(Object.values(getCharacter().poses));

    for (const posePath of posePaths) {
      const png = readFileSync(resolve(process.cwd(), 'public', posePath.replace(/^\//, '')));
      const hasAlphaChannel = png[25] === 4 || png[25] === 6;
      const hasTransparencyChunk = png.includes(Buffer.from('tRNS'));

      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(hasAlphaChannel || hasTransparencyChunk).toBe(true);
    }
  });

  it('falls back through neutral, idle, and the default character safely', () => {
    const base = getCharacter();
    const neutralOnly: CharacterDefinition = {
      ...base,
      id: 'neutral-test',
      poses: { neutral: '/assets/characters/test-neutral.png' },
    };
    const idleOnly: CharacterDefinition = {
      ...base,
      id: 'idle-test',
      poses: { idle: '/assets/characters/test-idle.png' },
    };

    expect(resolvePoseForCharacter(neutralOnly, 'celebrating')).toContain('test-neutral');
    expect(resolvePoseForCharacter(idleOnly, 'celebrating')).toContain('test-idle');
    expect(getCharacter('missing-character').id).toBe(DEFAULT_CHARACTER_ID);
    expect(resolveCharacterPose('missing-character', 'idle')).toBe(
      resolveCharacterPose(DEFAULT_CHARACTER_ID, 'idle'),
    );
  });

  it('rejects definitions without an idle or neutral fallback', () => {
    const invalid = { ...getCharacter(), poses: { correct: '/assets/characters/correct.png' } };
    expect(characterDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('provides future sound cues without playing audio', () => {
    expect(resolveCharacterSoundCue(undefined, 'greeting')).toBe('greeting');
    expect(resolveCharacterSoundCue(undefined, 'hint')).toBe('hint');
    expect(resolveCharacterSoundCue(undefined, 'correct')).toBe('correct');
    expect(resolveCharacterSoundCue(undefined, 'incorrect')).toBe('incorrect');
    expect(resolveCharacterSoundCue(undefined, 'celebrating')).toBe('celebrate');
    expect(resolveCharacterSoundCue(undefined, 'neutral')).toBeNull();
  });
});
