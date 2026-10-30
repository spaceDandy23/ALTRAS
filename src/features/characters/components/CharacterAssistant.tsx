import { getCharacter } from '../character.manifest';
import type {
  CharacterAnnouncement,
  CharacterPresentation,
  CharacterState,
} from '../character.types';
import { CharacterDialogue } from './CharacterDialogue';
import { CharacterPortrait } from './CharacterPortrait';

export function CharacterAssistant({
  characterId,
  state,
  dialogue,
  presentation = 'compact',
  reactionKey,
  announcement = 'polite',
  className = '',
}: {
  characterId?: string;
  state: CharacterState;
  dialogue: string;
  presentation?: CharacterPresentation;
  reactionKey?: string | number;
  announcement?: CharacterAnnouncement;
  className?: string;
}) {
  const character = getCharacter(characterId);

  return (
    <aside
      className={`character-assistant character-assistant--${presentation} ${className}`.trim()}
      data-character-id={character.id}
      data-character-state={state}
      aria-label={`${character.displayName}, learning companion`}
    >
      <CharacterPortrait
        characterId={character.id}
        state={state}
        presentation={presentation}
        reactionKey={reactionKey}
      />
      <CharacterDialogue dialogue={dialogue} announcement={announcement} />
    </aside>
  );
}
