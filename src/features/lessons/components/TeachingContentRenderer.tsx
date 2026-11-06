import type { InstructionalContentBlock } from '@/features/lessons/domain/content.schemas';
import { VocabularyTable } from './VocabularyTable';

export function TeachingContentRenderer({ blocks }: { blocks: InstructionalContentBlock[] }) {
  return (
    <div className="chapter-teaching__content">
      {blocks.map((block) => (
        <article
          key={block.id}
          className={`chapter-teaching__block chapter-teaching__block--${block.type}`}
        >
          <h2>{block.type === 'example' ? block.phrase : block.title}</h2>
          {block.type === 'vocabulary-table' ? (
            <VocabularyTable title={block.title} rows={block.rows} />
          ) : (
            <p>{block.type === 'example' ? `${block.expression} — ${block.note}` : block.body}</p>
          )}
        </article>
      ))}
    </div>
  );
}
