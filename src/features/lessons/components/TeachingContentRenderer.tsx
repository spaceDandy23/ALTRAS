import type { InstructionalContentBlock } from '@/features/lessons/domain/content.schemas';
import { VocabularyTables } from './VocabularyTable';
import { vocabularyTables } from '../domain/content-tables';

export function TeachingContentRenderer({ blocks }: { blocks: InstructionalContentBlock[] }) {
  return (
    <div className="chapter-teaching__content">
      {blocks
        .filter((block) => block.type !== 'vocabulary-table' || vocabularyTables(block).length > 0)
        .map((block) => (
          <article
            key={block.id}
            className={`chapter-teaching__block chapter-teaching__block--${block.type}`}
          >
            {block.type !== 'vocabulary-table' && (
              <h2>{block.type === 'example' ? block.phrase : block.title}</h2>
            )}
            {block.type === 'vocabulary-table' ? (
              <VocabularyTables tables={vocabularyTables(block)} />
            ) : (
              <p>{block.type === 'example' ? `${block.expression} — ${block.note}` : block.body}</p>
            )}
          </article>
        ))}
    </div>
  );
}
