import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MathWordListManagementPage } from '@/features/admin/MathWordListManagementPage';
import { AlmanacPage } from './AlmanacPage';
import { WordListPage } from './WordListPage';
import * as service from './word-list.service';

vi.mock('./word-list.service', () => ({ listMathWordEntries: vi.fn(), saveMathWordEntries: vi.fn() }));
const rows = [
  { id: 'sum', term: 'sum', definition: 'Addition result', example: 'n + 5' },
  { id: 'difference', term: 'difference', definition: 'Subtraction result', example: 'n - 5' },
];

describe('Math Word List CMS and student view', () => {
  beforeEach(() => {
    vi.mocked(service.listMathWordEntries).mockResolvedValue(rows);
    vi.mocked(service.saveMathWordEntries).mockImplementation(async (entries) => entries);
  });

  it('loads CMS data in the student Math Word List', async () => {
    render(<MemoryRouter><WordListPage /></MemoryRouter>);
    expect(await screen.findByText('Addition result')).toBeVisible();
    expect(screen.getByText('n + 5')).toBeVisible();
  });

  it('edits, reorders, adds, removes, and saves global entries', async () => {
    render(<MathWordListManagementPage />);
    expect(await screen.findByLabelText('Term 1')).toHaveValue('sum');
    fireEvent.change(screen.getByLabelText('Definition 1'), { target: { value: 'A total' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move row 2 up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove row 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Math Word List' }));
    await waitFor(() => expect(service.saveMathWordEntries).toHaveBeenCalledWith([
      rows[1],
      { ...rows[0], definition: 'A total' },
    ]));
  });

  it('searches global entries and preserves hidden rows when editing a result', async () => {
    const user = userEvent.setup();
    render(<MathWordListManagementPage />);
    const search = await screen.findByRole('searchbox', { name: 'Search entries' });
    await user.type(search, 'subtraction');
    expect(screen.getByLabelText('Term 2')).toHaveValue('difference');
    expect(screen.queryByLabelText('Term 1')).not.toBeInTheDocument();
    await user.clear(search);
    expect(screen.getByLabelText('Term 1')).toHaveValue('sum');
    expect(screen.getByLabelText('Term 2')).toHaveValue('difference');
  });

  it('reorders entries by dragging their handle and saves the new order', async () => {
    render(<MathWordListManagementPage />);
    await screen.findByLabelText('Term 1');
    const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };
    const sourceHandle = screen.getByRole('button', { name: 'Drag row 1 to reorder' });
    fireEvent.dragStart(sourceHandle, { dataTransfer: transfer });
    const reorderItems = document.querySelectorAll('.reference-rows-editor .admin-reorder-item');
    fireEvent.dragOver(reorderItems[1], { dataTransfer: transfer, clientY: 1 });
    expect(reorderItems[1]).toHaveClass('admin-reorder-item--after');
    fireEvent.drop(reorderItems[1], { dataTransfer: transfer, clientY: 1 });
    fireEvent.dragEnd(sourceHandle, { dataTransfer: transfer });
    expect(screen.getByLabelText('Term 1')).toHaveValue('difference');
    expect(screen.getByLabelText('Term 2')).toHaveValue('sum');
    fireEvent.click(screen.getByRole('button', { name: 'Save Math Word List' }));
    await waitFor(() => expect(service.saveMathWordEntries).toHaveBeenCalledWith([rows[1], rows[0]]));
  });

  it('removes the Review placeholder from Almanac', () => {
    render(<MemoryRouter><AlmanacPage /></MemoryRouter>);
    expect(screen.queryByText('Coming next')).not.toBeInTheDocument();
    expect(screen.queryByText('Review')).not.toBeInTheDocument();
    expect(screen.queryByText(/Practice from previous mistakes/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Math Word List/ })).toBeVisible();
  });
});
