import type { InstructionalContentBlock } from '@/features/lessons/domain/content.schemas';
import { newContentTable } from '@/features/lessons/domain/content-tables';
import { ContentTablesEditor } from './ContentTablesEditor';
import { ValidationScope, ValidatedFormField, ValidatedTextareaField, ValidatedSelectField, type ValidationPathPart } from './lesson-validation';

type EditableInstructionalContent = Exclude<InstructionalContentBlock, { type: 'vocabulary-table' }>;

export function InstructionalContentEditor({
  block,
  onChange,
  validationPath = [],
}: {
  block: EditableInstructionalContent;
  onChange: (block: EditableInstructionalContent) => void;
  validationPath?: ValidationPathPart[];
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
    <ValidationScope path={validationPath}>
    <div className={`admin-instruction-fields${block.type === 'content-table' ? ' admin-instruction-fields--tables' : ''}`}>
      <ValidatedSelectField
        label="Content type"
        validationPath={['type']}
          value={block.type}
          onChange={(event) =>
            changeType(event.target.value as Exclude<InstructionalContentBlock['type'], 'vocabulary-table'>)
          }
        >
          <option value="paragraph">Explanation</option>
          <option value="example">Example</option>
          <option value="warning">Important note</option>
          <option value="content-table">Dynamic tables</option>
      </ValidatedSelectField>
      {block.type === 'content-table' ? (
        <ContentTablesEditor validationPath={['tables']} tables={block.tables} onChange={(tables) => onChange({ ...block, tables })} />
      ) : block.type === 'example' ? (
        <>
          <ValidatedFormField
            label="Example phrase"
            validationPath={['phrase']}
            value={block.phrase}
            onChange={(event) => onChange({ ...block, phrase: event.target.value })}
          />
          <ValidatedFormField
            label="Mathematical expression"
            validationPath={['expression']}
            value={block.expression}
            onChange={(event) => onChange({ ...block, expression: event.target.value })}
          />
          <ValidatedTextareaField
            label="Explanation"
            validationPath={['note']}
              value={block.note}
              onChange={(event) => onChange({ ...block, note: event.target.value })}
            />
        </>
      ) : (
        <>
          <ValidatedFormField
            label="Teaching content title"
            validationPath={['title']}
            value={block.title}
            onChange={(event) => onChange({ ...block, title: event.target.value })}
          />
          <ValidatedTextareaField
            label="Teaching content"
            validationPath={['body']}
              value={block.body}
              onChange={(event) => onChange({ ...block, body: event.target.value })}
            />
        </>
      )}
    </div>
    </ValidationScope>
  );
}
