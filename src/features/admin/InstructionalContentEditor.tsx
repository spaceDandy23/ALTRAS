import { FormField } from '@/components/ui/FormField';
import type { InstructionalContentBlock } from '@/features/lessons/domain/content.schemas';
import { newContentTable } from '@/features/lessons/domain/content-tables';
import { ContentTablesEditor } from './ContentTablesEditor';

type EditableInstructionalContent = Exclude<InstructionalContentBlock, { type: 'vocabulary-table' }>;

export function InstructionalContentEditor({
  block,
  onChange,
}: {
  block: EditableInstructionalContent;
  onChange: (block: EditableInstructionalContent) => void;
}) {
  const changeType = (type: Exclude<InstructionalContentBlock['type'], 'vocabulary-table'>) => {
    if (type === 'example') {
      onChange({ id: block.id, type, phrase: '', expression: '', note: '' });
    } else if (type === 'content-table') {
      onChange({ id: block.id, type, tables: [newContentTable()] });
    } else {
      onChange({ id: block.id, type, title: '', body: '' });
    }
  };

  return (
    <div className={`admin-instruction-fields${block.type === 'content-table' ? ' admin-instruction-fields--tables' : ''}`}>
      <label>
        Content type
        <select
          value={block.type}
          onChange={(event) =>
            changeType(event.target.value as Exclude<InstructionalContentBlock['type'], 'vocabulary-table'>)
          }
        >
          <option value="paragraph">Explanation</option>
          <option value="example">Example</option>
          <option value="warning">Important note</option>
          <option value="content-table">Dynamic tables</option>
        </select>
      </label>
      {block.type === 'content-table' ? (
        <ContentTablesEditor tables={block.tables} onChange={(tables) => onChange({ ...block, tables })} />
      ) : block.type === 'example' ? (
        <>
          <FormField
            label="Example phrase"
            value={block.phrase}
            onChange={(event) => onChange({ ...block, phrase: event.target.value })}
          />
          <FormField
            label="Mathematical expression"
            value={block.expression}
            onChange={(event) => onChange({ ...block, expression: event.target.value })}
          />
          <label className="admin-textarea-field">
            Explanation
            <textarea
              value={block.note}
              onChange={(event) => onChange({ ...block, note: event.target.value })}
            />
          </label>
        </>
      ) : (
        <>
          <FormField
            label="Teaching content title"
            value={block.title}
            onChange={(event) => onChange({ ...block, title: event.target.value })}
          />
          <label className="admin-textarea-field">
            Teaching content
            <textarea
              value={block.body}
              onChange={(event) => onChange({ ...block, body: event.target.value })}
            />
          </label>
        </>
      )}
    </div>
  );
}
