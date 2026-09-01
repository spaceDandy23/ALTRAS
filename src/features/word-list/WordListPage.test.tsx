import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AltrasDatabase } from '@/db/database';
import { registerUser } from '@/features/auth/auth.service';
import {
  startOrResumeAttempt,
  submitActivityAnswer,
} from '@/features/lessons/attempts/attempt.service';
import { getLesson, initializePackagedContent } from '@/features/lessons/content/content.service';
import { ensureUserLessonProgress } from '@/features/lessons/progress/progress.service';
import { AlmanacPage } from './AlmanacPage';
import { WordListPage } from './WordListPage';
import { mathWordGroups, wordListSchema } from './word-list.data';

function renderWordList() {
  return render(
    <MemoryRouter initialEntries={['/lessons/almanac/word-list']}>
      <Routes>
        <Route path="/lessons/almanac/word-list" element={<WordListPage />} />
        <Route path="/lessons/almanac" element={<p>Almanac destination</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Math word list', () => {
  let database: AltrasDatabase | null = null;

  afterEach(async () => {
    if (database) await database.delete();
    database = null;
  });

  it('validates and displays all operation groups and expected vocabulary', () => {
    expect(wordListSchema.parse(mathWordGroups)).toHaveLength(4);
    renderWordList();

    for (const operation of ['Addition', 'Subtraction', 'Multiplication', 'Division']) {
      expect(screen.getByRole('heading', { name: operation })).toBeVisible();
    }
    for (const term of ['sum', 'less than', 'subtracted from', 'product', 'ratio']) {
      expect(screen.getByText(term)).toBeVisible();
    }
    expect(screen.getByRole('img', { name: 'Addition: plus sign' })).toHaveTextContent('+');
    expect(screen.getByRole('img', { name: 'Division: division sign' })).toHaveTextContent('÷');
  });

  it('filters immediately with case-insensitive, trimmed searches and clears the query', async () => {
    const user = userEvent.setup();
    renderWordList();
    const search = screen.getByRole('searchbox', { name: 'Search the word list' });

    await user.type(search, '  PRODUCT  ');
    expect(screen.getByRole('heading', { name: 'Multiplication' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Addition' })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, '  RaTiO  ');
    expect(screen.getByRole('heading', { name: 'Division' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Multiplication' })).not.toBeInTheDocument();

    await user.clear(search);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(4);
  });

  it('shows a helpful empty state and restores every group when search is cleared', async () => {
    const user = userEvent.setup();
    renderWordList();
    const search = screen.getByRole('searchbox', { name: 'Search the word list' });

    await user.type(search, 'not a math phrase');
    expect(screen.getByRole('heading', { name: 'No matching words' })).toBeVisible();
    expect(screen.getByText(/operation name, symbol, keyword, or example phrase/i)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(search).toHaveValue('');
    expect(screen.getByRole('heading', { name: 'Addition' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Division' })).toBeVisible();
  });

  it('identifies order-sensitive phrases with explicit guidance, not color alone', () => {
    renderWordList();

    expect(screen.getAllByText('Order-sensitive')).toHaveLength(2);
    expect(
      screen.getByRole('complementary', { name: 'Order-sensitive subtraction guidance' }),
    ).toHaveTextContent('six less than a number is n − 6');
    expect(
      screen.getByRole('complementary', { name: 'Order-sensitive subtraction guidance' }),
    ).toHaveTextContent('difference of A and B');
    expect(
      screen.getByRole('complementary', { name: 'Division order guidance' }),
    ).toHaveTextContent('quotient of A and B');
  });

  it('returns the Word list to Almanac', async () => {
    const user = userEvent.setup();
    renderWordList();
    await user.click(screen.getByRole('link', { name: 'Back to Almanac' }));
    expect(screen.getByText('Almanac destination')).toBeVisible();
  });

  it('shows the Almanac hierarchy with disabled Review and available Word list', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/lessons/almanac']}>
        <Routes>
          <Route path="/lessons/almanac" element={<AlmanacPage />} />
          <Route path="/lessons" element={<p>Lessons destination</p>} />
          <Route path="/lessons/almanac/word-list" element={<p>Word list destination</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Almanac' })).toBeVisible();
    expect(screen.getByLabelText('Mina, learning companion')).toHaveAttribute(
      'data-character-state',
      'explaining',
    );
    expect(screen.getByText('Coming next')).toBeVisible();
    expect(screen.getByText('Review').closest('[aria-disabled="true"]')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Review/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /Word list/ }));
    expect(screen.getByText('Word list destination')).toBeVisible();
  });

  it('does not mutate account, settings, session, attempt, progress, or XP records', async () => {
    database = new AltrasDatabase(`altras-word-list-${crypto.randomUUID()}`);
    await initializePackagedContent(database);
    const user = await registerUser(database, {
      username: 'reference_reader',
      displayName: 'Reference Reader',
      password: 'Reference123',
      confirmPassword: 'Reference123',
    });
    await ensureUserLessonProgress(database, user.id);
    const lesson = await getLesson(database, 'lesson-operation-signals');
    const attempt = await startOrResumeAttempt(database, user.id, lesson.id);
    const activity = lesson.activities[0];
    if (activity.type !== 'find-word') throw new Error('Unexpected activity fixture.');
    await submitActivityAnswer(database, attempt.id, activity.id, activity.correctChoiceId);
    const before = await Promise.all([
      database.users.toArray(),
      database.profiles.toArray(),
      database.settings.toArray(),
      database.sessions.toArray(),
      database.lessonAttempts.toArray(),
      database.lessonProgress.toArray(),
    ]);

    renderWordList();
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'subtracted from' } });
    fireEvent.change(search, { target: { value: '' } });

    await expect(
      Promise.all([
        database.users.toArray(),
        database.profiles.toArray(),
        database.settings.toArray(),
        database.sessions.toArray(),
        database.lessonAttempts.toArray(),
        database.lessonProgress.toArray(),
      ]),
    ).resolves.toEqual(before);
  });
});
