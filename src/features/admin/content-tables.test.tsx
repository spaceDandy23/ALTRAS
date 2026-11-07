import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContentTablesEditor } from './ContentTablesEditor';
import { TeachingContentRenderer } from '@/features/lessons/components/TeachingContentRenderer';
import {
  contentTablesSchema,
  instructionalContentBlockSchema,
  type ContentTable,
} from '@/features/lessons/domain/content.schemas';
import { vocabularyTables, type VocabularyBlock } from '@/features/lessons/domain/content-tables';

const tables: ContentTable[] = [
  {
    id: 'operations',
    title: 'Operations',
    columns: [
      { id: 'operation', label: 'Operation' },
      { id: 'symbol', label: 'Symbol' },
    ],
    rows: [
      { id: 'add', cells: { operation: 'Addition', symbol: '+' } },
      { id: 'subtract', cells: { operation: 'Subtraction', symbol: '−' } },
    ],
  },
  {
    id: 'translations',
    columns: [{ id: 'verbal', label: 'Verbal' }],
    rows: [{ id: 'sum', cells: { verbal: 'The sum' } }],
  },
];
function Editor({ initial = tables }: { initial?: ContentTable[] }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ContentTablesEditor tables={value} onChange={setValue} />
      <output data-testid="draft">{JSON.stringify(value)}</output>
    </>
  );
}
const value = (): ContentTable[] => JSON.parse(screen.getByTestId('draft').textContent!);
const firstTable = () => document.querySelector<HTMLElement>('.content-table-editor')!;
const confirmRemoval = () =>
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));

describe('configurable teaching tables', () => {
  it('allows removing every table without leaving an empty student card', () => {
    const block: VocabularyBlock = { id: 'reference', type: 'vocabulary-table', title: 'Vocabulary', rows: [], tables: [] };
    expect(instructionalContentBlockSchema.safeParse(block).success).toBe(true);
    const { container } = render(<TeachingContentRenderer blocks={[block]} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(container.querySelector('.chapter-teaching__block')).toBeNull();
  });
  it('creates multiple independent tables and edits optional titles, custom columns, rows and cells', () => {
    render(<Editor initial={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add table' }));
    fireEvent.change(screen.getByLabelText('Table title (optional)'), {
      target: { value: 'Operation words' },
    });
    fireEvent.change(screen.getByLabelText('Column 1'), { target: { value: 'Operation' } });
    fireEvent.change(screen.getByLabelText('Operation 1'), { target: { value: 'Addition' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    fireEvent.change(screen.getByLabelText('Column 4'), { target: { value: 'Symbol' } });
    fireEvent.change(screen.getByLabelText('Symbol 1'), { target: { value: '+' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    fireEvent.change(screen.getByLabelText('Operation 2'), { target: { value: 'Subtraction' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add table' }));
    expect(value()).toHaveLength(2);
    expect(value()[0].columns).toHaveLength(4);
    expect(value()[1].columns).toHaveLength(3);
    expect(value()[0].rows).toHaveLength(2);
    expect(value()[1].rows).toHaveLength(1);
    expect(value()[0].rows[0].cells.term).toBe('Addition');
    expect(new Set(value().map((table) => table.id)).size).toBe(2);
    expect(contentTablesSchema.safeParse(value()).success).toBe(true);
  });

  it('reorders tables, columns and rows without losing edits, IDs or cell associations', () => {
    render(<Editor />);
    const first = within(firstTable());
    fireEvent.change(first.getByLabelText('Operation 1'), { target: { value: 'Edited addition' } });
    fireEvent.click(first.getByRole('button', { name: 'Move column 2 up' }));
    fireEvent.click(first.getByRole('button', { name: 'Move row 2 up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move table 2 up' }));
    expect(value().map((table) => table.id)).toEqual(['translations', 'operations']);
    expect(value()[1].columns.map((column) => column.id)).toEqual(['symbol', 'operation']);
    expect(value()[1].rows.map((row) => row.id)).toEqual(['subtract', 'add']);
    expect(value()[1].rows[1].cells).toEqual({ operation: 'Edited addition', symbol: '+' });
  });

  it('supports existing drag handles for all three ordering levels', () => {
    render(<Editor />);
    const drag = (source: HTMLElement, target: HTMLElement) => {
      const dataTransfer = { setData: () => {}, effectAllowed: '', dropEffect: '' };
      fireEvent.dragStart(source, { dataTransfer });
      fireEvent.drop(target.closest('.admin-reorder-item')!, { dataTransfer, clientY: 1 });
      fireEvent.dragEnd(source, { dataTransfer });
    };
    const first = within(firstTable());
    drag(
      first.getByRole('button', { name: 'Drag column 1 to reorder' }),
      first.getByRole('button', { name: 'Drag column 2 to reorder' }),
    );
    drag(
      first.getByRole('button', { name: 'Drag row 1 to reorder' }),
      first.getByRole('button', { name: 'Drag row 2 to reorder' }),
    );
    drag(
      screen.getByRole('button', { name: 'Drag table 1 to reorder' }),
      screen.getByRole('button', { name: 'Drag table 2 to reorder' }),
    );
    expect(value()[1].id).toBe('operations');
    expect(value()[1].columns[0].id).toBe('symbol');
    expect(value()[1].rows[0].id).toBe('subtract');
  });

  it('confirms deletion and removes columns with their cells, rows, and whole tables', () => {
    render(<Editor />);
    fireEvent.click(within(firstTable()).getByRole('button', { name: 'Remove column 2' }));
    expect(value()[0].columns).toHaveLength(2);
    confirmRemoval();
    expect(value()[0].rows[0].cells).toEqual({ operation: 'Addition' });
    expect(within(firstTable()).getByRole('button', { name: 'Remove column 1' })).toBeDisabled();
    fireEvent.click(within(firstTable()).getByRole('button', { name: 'Remove row 1' }));
    confirmRemoval();
    expect(value()[0].rows.map((row) => row.id)).toEqual(['subtract']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove table 1' }));
    confirmRemoval();
    expect(value()).toEqual([tables[1]]);
  });

  it('adapts legacy vocabulary without mutating it or losing blank cells and stable IDs', () => {
    const legacy: VocabularyBlock = {
      id: 'legacy',
      type: 'vocabulary-table',
      title: 'Vocabulary',
      rows: [{ id: 'quantity', term: 'Quantity', definition: '', example: '' }],
    };
    const copy = structuredClone(legacy);
    const converted = vocabularyTables(legacy);
    expect(converted[0]).toMatchObject({
      id: 'legacy',
      rows: [{ id: 'quantity', cells: { term: 'Quantity', definition: '', example: '' } }],
    });
    expect(legacy).toEqual(copy);
    expect(contentTablesSchema.safeParse(converted).success).toBe(true);
    expect(instructionalContentBlockSchema.safeParse(legacy).success).toBe(true);
  });

  it('rejects duplicate IDs, missing/unknown cells and invalid column labels', () => {
    expect(contentTablesSchema.safeParse([tables[0], tables[0]]).success).toBe(false);
    expect(
      contentTablesSchema.safeParse([
        { ...tables[0], columns: [tables[0].columns[0], tables[0].columns[0]] },
      ]).success,
    ).toBe(false);
    expect(
      contentTablesSchema.safeParse([
        { ...tables[0], rows: [tables[0].rows[0], tables[0].rows[0]] },
      ]).success,
    ).toBe(false);
    expect(
      contentTablesSchema.safeParse([
        { ...tables[0], rows: [{ id: 'r', cells: { operation: 'Missing symbol' } }] },
      ]).success,
    ).toBe(false);
    expect(
      contentTablesSchema.safeParse([
        { ...tables[0], rows: [{ id: 'r', cells: { operation: '', symbol: '', extra: '' } }] },
      ]).success,
    ).toBe(false);
    expect(
      contentTablesSchema.safeParse([{ ...tables[1], columns: [{ id: 'verbal', label: ' ' }] }])
        .success,
    ).toBe(false);
  });

  it('renders custom tables in configured table/column/row order without exposing IDs', () => {
    render(
      <TeachingContentRenderer
        blocks={[
          { id: 'reference', type: 'vocabulary-table', title: 'Vocabulary', rows: [], tables },
        ]}
      />,
    );
    const rendered = screen.getAllByRole('table');
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toHaveAccessibleName('Operations');
    expect(rendered[1]).toHaveAccessibleName('Table 2');
    expect(
      within(rendered[0])
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Operation', 'Symbol']);
    expect(
      within(rendered[0])
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Addition', '+', 'Subtraction', '−']);
    expect(screen.queryByText('operations', { exact: true })).not.toBeInTheDocument();
  });
});
