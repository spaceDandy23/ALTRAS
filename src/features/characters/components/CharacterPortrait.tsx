import { useState } from 'react';
import {
  getCharacter,
  resolveCharacterPose,
  resolveCharacterSoundCue,
} from '../character.manifest';
import type { CharacterPresentation, CharacterState } from '../character.types';

function CharacterImage({ source, fallback }: { source: string; fallback: string }) {
  const [currentSource, setCurrentSource] = useState(source);

  return (
    <img
      src={currentSource}
      alt=""
      width="192"
      height="256"
      draggable="false"
      onError={(event) => {
        if (currentSource !== fallback) setCurrentSource(fallback);
        else event.currentTarget.hidden = true;
      }}
    />
  );
}

export function CharacterPortrait({
  characterId,
  state,
  presentation,
  reactionKey,
}: {
  characterId?: string;
  state: CharacterState;
  presentation: CharacterPresentation;
  reactionKey?: string | number;
}) {
  const character = getCharacter(characterId);
  const pose = resolveCharacterPose(character.id, state);
  const fallbackPose = resolveCharacterPose(character.id, 'neutral');
  return (
    <div
      className={`character-portrait character-portrait--${presentation}`}
      data-character-state={state}
      data-sound-cue={resolveCharacterSoundCue(character.id, state) ?? undefined}
      aria-hidden="true"
    >
      <div
        className="character-portrait__motion"
        key={`${state}:${pose}:${String(reactionKey ?? '')}`}
      >
        <CharacterImage source={pose} fallback={fallbackPose} />
      </div>
    </div>
  );
}
