import { Link, Navigate } from 'react-router-dom';
import { BackLink } from '@/components/ui/BackLink';
import { CharacterAssistant } from '@/features/characters/components/CharacterAssistant';
import { resolveCharacterDialogue } from '@/features/characters/character.dialogue';

export function AlmanacPage() {
  return (
    <div className="standard-page almanac-page page-enter">
      <BackLink to="/lessons" label="Back to lessons" />
      <header className="almanac-heading">
        <h1>Almanac</h1>
        <p>Reference tools for translating verbal expressions.</p>
      </header>
      <CharacterAssistant
        state="explaining"
        dialogue={resolveCharacterDialogue('resource-introduction')}
        presentation="inline"
        reactionKey="almanac-introduction"
        announcement="off"
        className="almanac-companion"
      />
      <div className="almanac-options" aria-label="Almanac tools">
        <article className="almanac-option almanac-option--disabled" aria-disabled="true">
          <div>
            <span>Coming next</span>
            <h2>Review</h2>
            <p>Practice from previous mistakes will be added in a later phase.</p>
          </div>
          <span aria-hidden="true">—</span>
        </article>
        <Link className="almanac-option" to="/lessons/almanac/word-list">
          <div>
            <span>Available</span>
            <h2>Word list</h2>
            <p>Look up common operation words, examples, and order-sensitive phrases.</p>
          </div>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}

export function AlmanacReviewPlaceholder() {
  return <Navigate to="/lessons/almanac" replace />;
}
