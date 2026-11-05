import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReferenceRowsEditor } from './ReferenceRowsEditor';
import { TeachingContentRenderer } from '@/features/lessons/components/TeachingContentRenderer';
import { packagedContent } from '@/features/lessons/content/packaged-content';

const rows = [
  { id: 'constant', term: 'Constant', definition: 'A single fixed number', example: '7' },
  { id: 'quantity', term: 'Quantity', definition: '', example: '' },
];

describe('reference content editors and rendering', () => {
  it('contains the supplied Lesson 1 vocabulary without inventing Quantity content', () => {
    const vocabulary = packagedContent.lessons[0].instructionalContent.find(
      (block) => block.type === 'vocabulary-table',
    );
    expect(vocabulary?.type).toBe('vocabulary-table');
    if (vocabulary?.type !== 'vocabulary-table') throw new Error('Missing Lesson 1 vocabulary.');
    expect(vocabulary.rows.map((row) => row.term)).toEqual([
      'Constant', 'Variable', 'Coefficient', 'Term', 'Base and Exponent', 'Quantity', 'Consecutive numbers',
    ]);
    expect(vocabulary.rows.find((row) => row.term === 'Quantity')).toMatchObject({ definition: '', example: '' });
  });

  it('adds, edits, reorders, and removes vocabulary rows', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ReferenceRowsEditor rows={rows} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Move row 2 up' }));
    expect(onChange).toHaveBeenLastCalledWith([rows[1], rows[0]]);

    fireEvent.change(screen.getByLabelText('Term 1'), { target: { value: 'Fixed value' } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...rows[0], term: 'Fixed value' }, rows[1]]);

    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    expect(onChange.mock.calls.at(-1)?.[0]).toHaveLength(3);

    rerender(<ReferenceRowsEditor rows={[...rows, { id: 'third', term: 'Term', definition: '', example: '' }]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove row 3' }));
    expect(onChange).toHaveBeenLastCalledWith(rows);
  });

  it('renders a vocabulary table with incomplete source rows safely', () => {
    render(
      <TeachingContentRenderer
        blocks={[{ id: 'vocabulary', type: 'vocabulary-table', title: 'Vocabulary', rows }]}
      />,
    );
    expect(screen.getByRole('table', { name: 'Vocabulary' })).toBeVisible();
    expect(screen.getByText('A single fixed number')).toBeVisible();
    expect(screen.getByText('Quantity')).toBeVisible();
  });
});
