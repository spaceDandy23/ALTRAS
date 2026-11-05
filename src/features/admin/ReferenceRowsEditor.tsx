import { useMemo, useState } from 'react';
import type { ReferenceEntry } from '@/features/lessons/domain/content.schemas';
import { moveItem } from './lesson-management.service';
import { AdminIconButton } from './AdminIconButton';
import { ReorderableItem, reorderById } from './ReorderableItem';

export function ReferenceRowsEditor({
  rows,
  onChange,
  searchable = false,
}: {
  rows: ReferenceEntry[];
  onChange: (rows: ReferenceEntry[]) => void;
  searchable?: boolean;
}) {
  const [search, setSearch] = useState('');
  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('en-US');
    if (!query) return rows;
    return rows.filter((row) =>
      [row.term, row.definition, row.example].some((value) =>
        value.toLocaleLowerCase('en-US').includes(query),
      ),
    );
  }, [rows, search]);
  const update = (id: string, field: 'term' | 'definition' | 'example', value: string) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));

  return (
    <>
    {searchable && (
      <label className="reference-rows-search">
        <span>Search entries</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search terms, definitions, or examples"
        />
      </label>
    )}
    <fieldset className="reference-rows-editor">
      <legend>Rows</legend>
      {visibleRows.map((row) => {
        const index = rows.findIndex((item) => item.id === row.id);
        return (
        <ReorderableItem
          key={row.id}
          group="reference-rows"
          id={row.id}
          label={`row ${index + 1}`}
          onReorder={(sourceId, targetId, side) =>
            onChange(reorderById(rows, sourceId, targetId, side, (item) => item.id))
          }
        >
          {(handle) => <div className="reference-row-editor">
          {handle}
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
            <AdminIconButton icon="up" label={`Move row ${index + 1} up`}
              disabled={index === 0}
              onClick={() => onChange(moveItem(rows, index, -1))}
            />
            <AdminIconButton icon="down" label={`Move row ${index + 1} down`}
              disabled={index === rows.length - 1}
              onClick={() => onChange(moveItem(rows, index, 1))}
            />
            <AdminIconButton icon="delete" label={`Remove row ${index + 1}`}
              onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
            />
          </div>
          </div>}
        </ReorderableItem>
      );})}
      {searchable && search.trim() && visibleRows.length === 0 && (
        <p className="reference-rows-search__empty">No matching entries. Try another search.</p>
      )}
      <button
        type="button"
        className="admin-add-action"
        onClick={() => {
          setSearch('');
          onChange([
            ...rows,
            { id: `reference-${crypto.randomUUID()}`, term: '', definition: '', example: '' },
          ]);
        }}
      >
        Add row
      </button>
    </fieldset>
    </>
  );
}
