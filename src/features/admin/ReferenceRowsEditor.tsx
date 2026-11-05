import type { ReferenceEntry } from '@/features/lessons/domain/content.schemas';
import { moveItem } from './lesson-management.service';

export function ReferenceRowsEditor({
  rows,
  onChange,
}: {
  rows: ReferenceEntry[];
  onChange: (rows: ReferenceEntry[]) => void;
}) {
  const update = (id: string, field: 'term' | 'definition' | 'example', value: string) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));

  return (
    <fieldset className="reference-rows-editor">
      <legend>Rows</legend>
      {rows.map((row, index) => (
        <div className="reference-row-editor" key={row.id}>
          <label>
            Term {index + 1}
            <input
              required
              value={row.term}
              onChange={(event) => update(row.id, 'term', event.target.value)}
            />
          </label>
          <label>
            Definition {index + 1}
            <textarea
              value={row.definition}
              onChange={(event) => update(row.id, 'definition', event.target.value)}
            />
          </label>
          <label>
            Example {index + 1}
            <textarea
              value={row.example}
              onChange={(event) => update(row.id, 'example', event.target.value)}
            />
          </label>
          <div className="reference-row-editor__actions">
            <button
              type="button"
              disabled={index === 0}
              aria-label={`Move row ${index + 1} up`}
              onClick={() => onChange(moveItem(rows, index, -1))}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={index === rows.length - 1}
              aria-label={`Move row ${index + 1} down`}
              onClick={() => onChange(moveItem(rows, index, 1))}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Remove row ${index + 1}`}
              onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...rows,
            { id: `reference-${crypto.randomUUID()}`, term: '', definition: '', example: '' },
          ])
        }
      >
        Add row
      </button>
    </fieldset>
  );
}
