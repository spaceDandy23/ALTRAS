import { FormField } from '@/components/ui/FormField';
import type { InstructionalContentBlock } from '@/features/lessons/domain/content.schemas';

export function InstructionalContentEditor({
  block,
  onChange,
}: {
  block: InstructionalContentBlock;
  onChange: (block: InstructionalContentBlock) => void;
}) {
  const changeType = (type: InstructionalContentBlock['type']) => {
    if (type === 'example') {
      onChange({ id: block.id, type, phrase: '', expression: '', note: '' });
    } else {
      onChange({ id: block.id, type, title: '', body: '' });
    }
  };

  return (
    <div className="admin-instruction-fields">
      <label>
        Content type
        <select
          value={block.type}
          onChange={(event) => changeType(event.target.value as InstructionalContentBlock['type'])}
        >
          <option value="paragraph">Explanation</option>
          <option value="example">Example</option>
          <option value="warning">Important note</option>
        </select>
      </label>
      {block.type === 'example' ? (
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
