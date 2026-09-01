import type { CharacterAnnouncement } from '../character.types';

export function CharacterDialogue({
  dialogue,
  announcement = 'polite',
}: {
  dialogue: string;
  announcement?: CharacterAnnouncement;
}) {
  return (
    <div className="character-dialogue">
      <span className="character-dialogue__tail" aria-hidden="true" />
      <p
        key={dialogue}
        aria-live={announcement === 'off' ? undefined : announcement}
        aria-atomic={announcement === 'off' ? undefined : 'true'}
      >
        {dialogue}
      </p>
    </div>
  );
}
