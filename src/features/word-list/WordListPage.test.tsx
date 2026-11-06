import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WordListPage } from './WordListPage';
import { listMathWordEntries } from './word-list.service';

vi.mock('./word-list.service', () => ({ listMathWordEntries: vi.fn() }));
const entries = [
  { id: 'sum', term: 'sum', definition: 'Addition result', example: 'n + 5' },
  { id: 'difference', term: 'difference', definition: 'Subtraction result', example: 'n - 5' },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/lessons/almanac/word-list']}>
      <Routes>
        <Route path="/lessons/almanac/word-list" element={<WordListPage />} />
        <Route path="/lessons/almanac" element={<p>Almanac destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Math Word List', () => {
  beforeEach(() => vi.mocked(listMathWordEntries).mockResolvedValue(entries));

  it('renders saved entries and filters term, definition, and example text', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('sum')).toBeVisible();
    const search = screen.getByRole('searchbox', { name: 'Search the word list' });
    await user.type(search, 'SUBTRACTION');
    expect(screen.getByText('difference')).toBeVisible();
    expect(screen.queryByText('sum')).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'n + 5');
    expect(screen.getByText('sum')).toBeVisible();
    expect(screen.queryByText('difference')).not.toBeInTheDocument();
  });

  it('shows an empty search state and clears it', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('sum');
    await user.type(screen.getByRole('searchbox'), 'unknown');
    expect(screen.getByRole('heading', { name: 'No matching words' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText('sum')).toBeVisible();
  });

  it('returns to Almanac', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('sum');
    await user.click(screen.getByRole('link', { name: 'Back to Almanac' }));
    expect(screen.getByText('Almanac destination')).toBeVisible();
  });
});
