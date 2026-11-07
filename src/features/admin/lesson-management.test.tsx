import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { packagedContent } from '@/features/lessons/content/packaged-content';
import { applyExperienceScope } from '@/features/researcher/researcher-experience';
import { db } from '@/db/database';
import { AdminRoute } from './AdminRoute';
import { ActivityEditor } from './ActivityEditor';
import { LessonManagementPage } from './LessonManagementPage';
import { LessonContentPreview } from './LessonContentPreview';
import {
  MAX_ACTIVITIES,
  MAX_LESSONS,
  newActivity,
  newChapter,
  normalizeAuthoredLesson,
  publishManagedLesson,
  saveManagedLesson,
  totalLessonActivities,
  type AuthoredLesson,
  type ManagedLesson,
} from './lesson-management.service';

const client = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/services/supabase.client', () => ({ getSupabaseClient: () => client }));
const item = (): ManagedLesson => {
  const draft = normalizeAuthoredLesson(structuredClone(packagedContent.lessons[0]));
  draft.assessments = { preTest: 'pre-test', postTest: 'post-test' };
  const question = (id: string) => ({
    id,
    prompt: `Question ${id}`,
    choices: [{ id: `${id}-a`, label: 'A' }, { id: `${id}-b`, label: 'B' }],
    correctChoiceId: `${id}-a`,
    isPlaceholder: false,
  });
  draft.assessmentQuestions = {
    'pre-test': [question('pre-question')],
    'post-test': [question('post-question')],
  };
  return { lesson_id: draft.id, draft, revision: 1, published: true, published_version: 1 };
};
beforeEach(() => {
  vi.clearAllMocks();
  applyExperienceScope('neutral');
  client.rpc.mockImplementation(
    async (name: string, args?: { p_lesson: ManagedLesson['draft'] }) => ({
      error: null,
      data:
        name === 'get_admin_lessons'
          ? [item()]
          : name === 'save_admin_lesson'
            ? { ...item(), draft: args!.p_lesson, revision: 2 }
            : name === 'is_admin'
              ? true
              : { ...item(), revision: 3 },
    }),
  );
});
afterEach(() => {
  useAuthStore.setState({ user: null, status: 'guest' });
  applyExperienceScope('neutral');
});
const page = () =>
  render(
    <MemoryRouter>
      <LessonManagementPage />
    </MemoryRouter>,
  );

function dragAfter(source: HTMLElement, target: HTMLElement) {
  const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
  const targetItem = target.closest('.admin-reorder-item');
  if (!targetItem) throw new Error('Missing drop target');
  fireEvent.dragStart(source, { dataTransfer: transfer });
  fireEvent.dragOver(targetItem, { dataTransfer: transfer, clientY: 1 });
  expect(targetItem).toHaveClass('admin-reorder-item--after');
  fireEvent.drop(targetItem, { dataTransfer: transfer, clientY: 1 });
  expect(targetItem).not.toHaveClass('admin-reorder-item--after');
  fireEvent.dragEnd(source, { dataTransfer: transfer });
}

describe('Basic Lesson Management editor and preview', () => {
  it('drag-reorders chapters, chapter content, activities and both assessments in the saved draft', async () => {
    const row = item();
    const firstChapter = row.draft.chapters[0];
    firstChapter.activities = firstChapter.activities.slice(0, 2);
    firstChapter.instructionalContent = [firstChapter.instructionalContent[0], {
      id: 'vocabulary-reference', type: 'vocabulary-table', title: 'Vocabulary',
      rows: [{ id: 'term-1', term: 'Variable', definition: 'Unknown', example: 'x' }],
    }];
    const secondChapter = newChapter(2, 'Second chapter');
    row.draft.chapters = [firstChapter, secondChapter];
    for (const kind of ['pre-test', 'post-test'] as const) {
      const first = row.draft.assessmentQuestions[kind][0];
      row.draft.assessmentQuestions[kind] = [first, { ...first, id: `${kind}-second`, prompt: 'Second question' }];
    }
    row.draft = normalizeAuthoredLesson(row.draft);
    client.rpc.mockImplementation(async (name: string, args?: { p_lesson: AuthoredLesson }) => ({
      error: null,
      data: name === 'get_admin_lessons' ? [row] : { ...row, draft: args!.p_lesson, revision: 2 },
    }));
    const { container } = page();
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${row.draft.title}` }));

    for (const label of ['Pre-test', 'Post-test']) {
      const section = screen.getByRole('region', { name: `Lesson ${label}` });
      fireEvent.click(section.querySelector('summary')!);
      dragAfter(screen.getByRole('button', { name: `Drag ${label} question 1 to reorder` }),
        screen.getByRole('button', { name: `Drag ${label} question 2 to reorder` }));
    }

    fireEvent.click(container.querySelector('.admin-chapter-details > summary')!);
    const firstActivity = container.querySelector<HTMLElement>('.admin-activity')!;
    fireEvent.click(firstActivity.querySelector('summary')!);
    fireEvent.change(within(firstActivity).getByLabelText('Activity title'), { target: { value: 'Unsaved activity edit' } });
    dragAfter(screen.getByRole('button', { name: 'Drag teaching content 1 to reorder' }),
      screen.getByRole('button', { name: 'Drag teaching content 2 to reorder' }));
    dragAfter(screen.getByRole('button', { name: 'Drag activity 1 to reorder' }),
      screen.getByRole('button', { name: 'Drag activity 2 to reorder' }));
    expect(firstActivity).toHaveAttribute('open');
    expect(within(firstActivity).getByLabelText('Activity title')).toHaveValue('Unsaved activity edit');
    dragAfter(screen.getByRole('button', { name: 'Drag chapter 1 to reorder' }),
      screen.getByRole('button', { name: 'Drag chapter 2 to reorder' }));
    expect(firstActivity).toHaveAttribute('open');
    expect(within(firstActivity).getByLabelText('Activity title')).toHaveValue('Unsaved activity edit');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Draft saved.');

    expect(client.rpc).toHaveBeenCalledWith('save_admin_lesson', expect.objectContaining({
      p_lesson: expect.objectContaining({
        chapters: [expect.objectContaining({ id: secondChapter.id, displayOrder: 1 }), expect.objectContaining({
          id: firstChapter.id, displayOrder: 2,
          instructionalContent: [expect.objectContaining({ id: 'vocabulary-reference' }), expect.objectContaining({ id: firstChapter.instructionalContent[0].id })],
          activities: [expect.objectContaining({ id: firstChapter.activities[1].id }), expect.objectContaining({ id: firstChapter.activities[0].id, title: 'Unsaved activity edit' })],
        })],
        assessmentQuestions: expect.objectContaining({
          'pre-test': [expect.objectContaining({ id: 'pre-test-second' }), expect.objectContaining({ id: 'pre-question' })],
          'post-test': [expect.objectContaining({ id: 'post-test-second' }), expect.objectContaining({ id: 'post-question' })],
        }),
      }),
    }));
  }, 15000);
  it('disables creating a ninth lesson and explains the limit', async () => {
    const rows = Array.from({ length: MAX_LESSONS }, (_, index) => ({
      ...item(),
      lesson_id: `lesson-${index}`,
      draft: { ...item().draft, id: `lesson-${index}`, title: `Lesson ${index + 1}` },
    }));
    client.rpc.mockResolvedValue({ data: rows, error: null });
    page();
    expect(await screen.findByText(`Maximum ${MAX_LESSONS} lessons reached.`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create lesson' })).toBeDisabled();
  });
  it('shows only the centered admin loader until lesson data is ready', async () => {
    let resolve!: (value: unknown) => void;
    client.rpc.mockReturnValueOnce(
      new Promise((complete) => {
        resolve = complete;
      }),
    );

    page();

    expect(screen.getByRole('status')).toHaveClass('loading-state--page', 'admin-content-loading');
    expect(screen.getByRole('status')).toHaveTextContent('Loading lessons…');
    expect(
      screen.queryByRole('heading', { name: 'Basic Lesson Management' }),
    ).not.toBeInTheDocument();

    await act(async () => resolve({ data: [item()], error: null }));
    expect(
      await screen.findByRole('heading', { name: 'Basic Lesson Management' }),
    ).toBeInTheDocument();
  });

  it('lists metadata and saves a changed draft without publishing it', async () => {
    const row = item();
    row.draft.chapters[0].activities = [];
    row.draft.chapters[0].instructionalContent = [];
    row.draft = normalizeAuthoredLesson(row.draft);
    client.rpc.mockImplementation(
      async (name: string, args?: { p_lesson: ManagedLesson['draft'] }) => ({
        error: null,
        data:
          name === 'get_admin_lessons'
            ? [row]
            : name === 'save_admin_lesson'
              ? { ...row, draft: args!.p_lesson, revision: 2 }
              : { ...row, revision: 3 },
      }),
    );
    page();
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${row.draft.title}` }));
    fireEvent.change(screen.getByLabelText('Lesson title'), { target: { value: 'Updated draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument();
    expect(client.rpc).toHaveBeenCalledWith(
      'save_admin_lesson',
      expect.objectContaining({
        p_revision: 1,
        p_lesson: expect.objectContaining({ title: 'Updated draft' }),
      }),
    );
    expect(client.rpc).not.toHaveBeenCalledWith('set_lesson_publication', expect.anything());
  });
  it('shows publish failures beside the lesson actions without requiring a scroll back to the heading', async () => {
    const row = item();
    client.rpc.mockImplementation(async (name: string) =>
      name === 'get_admin_lessons'
        ? { data: [row], error: null }
        : { data: null, error: { message: 'Could not publish this lesson.' } },
    );
    page();
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${row.draft.title}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish lesson' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not publish this lesson.');
    expect(alert.closest('.admin-save-feedback')).toBeInTheDocument();
    expect(alert.closest('.admin-save-feedback')).toHaveFocus();
  });
  it('blocks activity eleven in the editor', async () => {
    const row = item();
    row.draft.chapters[0].activities = Array.from({ length: 9 }, () => newActivity('find-word'));
    row.draft = normalizeAuthoredLesson(row.draft);
    client.rpc.mockResolvedValue({ data: [row], error: null });
    const { container } = page();
    fireEvent.click(await screen.findByText(`Edit ${row.draft.title}`, { selector: 'button' }));
    fireEvent.click(container.querySelector('.admin-chapter-details summary')!);
    const add = screen.getByRole('button', { name: 'Add activity to Chapter 1' });
    fireEvent.click(add);
    expect(add).toBeDisabled();
    expect(container.querySelectorAll('.admin-activity')).toHaveLength(MAX_ACTIVITIES);
    fireEvent.click(add);
    expect(container.querySelectorAll('.admin-activity')).toHaveLength(MAX_ACTIVITIES);
  });
  it('creates a draft, edits, reorders and deletes activities', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Create lesson' }));
    expect(screen.getByRole('checkbox', { name: 'Require lesson pre-test' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Require lesson post-test' })).toBeChecked();
    fireEvent.click(screen.getByText(/Chapter 1: Chapter 1/));
    const add = screen.getByRole('button', { name: 'Add activity to Chapter 1' });
    fireEvent.click(add);
    fireEvent.click(add);
    const activityCards = document.querySelectorAll<HTMLElement>('.admin-activity');
    fireEvent.click(within(activityCards[0]).getByText(/Activity 1 ·/));
    fireEvent.click(within(activityCards[1]).getByText(/Activity 2 ·/));
    const activities = screen.getAllByLabelText('Activity title');
    fireEvent.change(activities[0], { target: { value: 'First' } });
    fireEvent.change(activities[1], { target: { value: 'Second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move activity 2 up' }));
    expect(screen.getAllByLabelText('Activity title')[0]).toHaveValue('Second');
    fireEvent.click(screen.getByRole('button', { name: 'Delete activity 1' }));
    expect(screen.getAllByLabelText('Activity title')[0]).toHaveValue('First');
    expect(screen.getByRole('button', { name: 'Add activity to Chapter 1' })).toBeEnabled();
    fireEvent.change(screen.getAllByLabelText('Activity type')[0], {
      target: { value: 'organize-translate' },
    });
    expect(screen.getByRole('region', { name: 'Accepted answers' })).toBeInTheDocument();
    expect(screen.getByText('Accepted answer 1')).toBeInTheDocument();
  });
  it('creates and saves a Choose the Correct Translation activity in the collapsed editor', async () => {
    const row = item();
    row.draft.chapters[0].activities = [];
    row.draft = normalizeAuthoredLesson(row.draft);
    client.rpc.mockImplementation(
      async (name: string, args?: { p_lesson: ManagedLesson['draft'] }) => ({
        error: null,
        data: name === 'get_admin_lessons' ? [row] : { ...row, draft: args!.p_lesson, revision: 2 },
      }),
    );
    page();
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${row.draft.title}` }));
    fireEvent.click(screen.getByText(/Chapter 1: Chapter 1/));
    fireEvent.click(screen.getByRole('button', { name: 'Add activity to Chapter 1' }));

    const activityCard = document.querySelector<HTMLElement>('.admin-activity')!;
    fireEvent.click(activityCard.querySelector('summary')!);
    fireEvent.change(within(activityCard).getByLabelText('Activity type'), {
      target: { value: 'choose-correct-translation' },
    });
    fireEvent.change(within(activityCard).getByLabelText('Verbal phrase'), {
      target: { value: 'The sum of a number and five' },
    });
    fireEvent.change(within(activityCard).getByLabelText('Expression choice 1'), {
      target: { value: 'n + 5' },
    });
    fireEvent.change(within(activityCard).getByLabelText('Expression choice 2'), {
      target: { value: 'n - 5' },
    });
    expect(within(activityCard).queryByLabelText('Correct answer')).not.toBeInTheDocument();
    fireEvent.click(within(activityCard).getAllByRole('radio', { name: 'Correct' })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText('Draft saved.')).toBeInTheDocument();
    expect(client.rpc).toHaveBeenCalledWith(
      'save_admin_lesson',
      expect.objectContaining({
        p_lesson: expect.objectContaining({
          activities: expect.arrayContaining([
            expect.objectContaining({
              type: 'choose-correct-translation',
              prompt: 'The sum of a number and five',
              choices: expect.arrayContaining([
                expect.objectContaining({ label: 'n + 5' }),
                expect.objectContaining({ label: 'n - 5' }),
              ]),
              correctChoiceId: 'choice-2',
            }),
          ]),
        }),
      }),
    );
  });
  it('creates, edits, reorders and confirms deletion of ordered chapters', async () => {
    const row = item();
    row.draft.chapters[0].activities = [];
    row.draft.chapters[0].instructionalContent = [];
    row.draft = normalizeAuthoredLesson(row.draft);
    client.rpc.mockResolvedValue({ data: [row], error: null });
    page();
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${row.draft.title}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Add chapter' }));
    screen.getAllByText(/Chapter \d: /).forEach((summary) => fireEvent.click(summary));
    const titles = screen.getAllByLabelText('Chapter title');
    fireEvent.change(titles[1], { target: { value: 'Applications' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move chapter 2 up' }));
    expect(screen.getAllByLabelText('Chapter title')[0]).toHaveValue('Applications');

    fireEvent.click(screen.getByRole('button', { name: 'Delete chapter 1' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete chapter?' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Delete chapter' }));
    expect(screen.queryByDisplayValue('Applications')).not.toBeInTheDocument();
  });
  it('keeps chapter ownership and ordering when activities move between chapters', () => {
    const first = newChapter(1, 'Foundations');
    const second = newChapter(2, 'Applications');
    first.activities = [newActivity('find-word')];
    second.activities = [newActivity('organize-translate')];
    const lesson = normalizeAuthoredLesson({
      ...item().draft,
      chapters: [second, first],
      instructionalContent: [],
      activities: [],
    });

    expect(lesson.chapters.map((chapter) => chapter.title)).toEqual([
      'Foundations',
      'Applications',
    ]);
    expect(lesson.activities.map((activity) => activity.id)).toEqual([
      first.activities[0].id,
      second.activities[0].id,
    ]);
    expect(totalLessonActivities(lesson)).toBe(2);
  });
  it('authors teaching content inside a chapter and saves it with the lesson draft', async () => {
    const row = item();
    row.draft.chapters[0].activities = [];
    row.draft.chapters[0].instructionalContent = [];
    row.draft = normalizeAuthoredLesson(row.draft);
    client.rpc.mockImplementation(
      async (name: string, args?: { p_lesson: ManagedLesson['draft'] }) => ({
        error: null,
        data: name === 'get_admin_lessons' ? [row] : { ...row, draft: args!.p_lesson, revision: 2 },
      }),
    );
    page();
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${row.draft.title}` }));
    fireEvent.click(screen.getByText(/Chapter 1: Chapter 1/));
    fireEvent.click(screen.getByRole('button', { name: 'Add teaching content to Chapter 1' }));
    fireEvent.click(screen.getByText(/Content 1 · Explanation · Untitled content/));
    fireEvent.change(screen.getByLabelText('Teaching content title'), {
      target: { value: 'Variables' },
    });
    fireEvent.change(screen.getByLabelText('Teaching content'), {
      target: { value: 'A variable represents a number.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith(
        'save_admin_lesson',
        expect.objectContaining({
          p_lesson: expect.objectContaining({
            chapters: [
              expect.objectContaining({
                instructionalContent: [expect.objectContaining({ title: 'Variables' })],
              }),
            ],
          }),
        }),
      ),
    );
  });
  it('authors and saves Vocabulary from its collapsed lesson-level section', async () => {
    const row = item();
    row.draft.chapters[0].instructionalContent = [];
    row.draft = normalizeAuthoredLesson(row.draft);
    client.rpc.mockImplementation(
      async (name: string, args?: { p_lesson: ManagedLesson['draft'] }) => ({
        error: null,
        data: name === 'get_admin_lessons' ? [row] : { ...row, draft: args!.p_lesson, revision: 2 },
      }),
    );
    page();
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${row.draft.title}` }));
    const vocabularySection = screen.getByText('Vocabulary (not added)');
    expect(screen.queryByLabelText('Term 1')).not.toBeInTheDocument();
    fireEvent.click(vocabularySection);
    const vocabulary = within(vocabularySection.closest('details')!);
    fireEvent.click(await vocabulary.findByRole('button', { name: 'Add table' }));
    fireEvent.change(vocabulary.getByLabelText('Term 1'), { target: { value: 'Variable' } });
    fireEvent.change(vocabulary.getByLabelText('Definition 1'), { target: { value: 'An unknown value' } });
    fireEvent.click(vocabulary.getByRole('button', { name: 'Add row' }));
    fireEvent.change(vocabulary.getByLabelText('Term 2'), { target: { value: 'Constant' } });
    fireEvent.click(vocabulary.getByRole('button', { name: 'Move row 2 up' }));
    fireEvent.click(vocabulary.getByRole('button', { name: 'Remove row 2' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith(
        'save_admin_lesson',
        expect.objectContaining({
          p_lesson: expect.objectContaining({
            chapters: [expect.objectContaining({
              instructionalContent: [expect.objectContaining({
                type: 'vocabulary-table',
                rows: [],
                tables: [expect.objectContaining({ rows: [expect.objectContaining({ cells: expect.objectContaining({ term: 'Constant' }) })] })],
              })],
            })],
          }),
        }),
      ),
    );
  }, 20_000);
  it('authors lesson-scoped Pre-test and Post-test questions in the lesson draft', async () => {
    const row = item();
    client.rpc.mockImplementation(
      async (name: string, args?: { p_lesson: ManagedLesson['draft'] }) => ({
        error: null,
        data: name === 'get_admin_lessons' ? [row] : { ...row, draft: args!.p_lesson, revision: 2 },
      }),
    );
    const { container } = page();
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${row.draft.title}` }));
    const preTest = container.querySelector<HTMLElement>('[aria-label="Lesson Pre-test"]')!;
    fireEvent.click(preTest.querySelector('summary')!);
    fireEvent.click(preTest.querySelector('.admin-assessment-question summary')!);
    fireEvent.change(within(preTest).getByLabelText('Question text'), {
      target: { value: 'Lesson-specific pre-test wording' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() =>
      expect(client.rpc).toHaveBeenCalledWith(
        'save_admin_lesson',
        expect.objectContaining({
          p_lesson: expect.objectContaining({
            assessmentQuestions: expect.objectContaining({
              'pre-test': [expect.objectContaining({ prompt: 'Lesson-specific pre-test wording' })],
              'post-test': [expect.objectContaining({ id: 'post-question' })],
            }),
          }),
        }),
      ),
    );
  });
  it('edits assessment choices as reorderable compact rows with a per-choice correct selector', async () => {
    const row = item();
    client.rpc.mockImplementation(
      async (name: string, args?: { p_lesson: ManagedLesson['draft'] }) => ({
        error: null,
        data: name === 'get_admin_lessons' ? [row] : { ...row, draft: args!.p_lesson, revision: 2 },
      }),
    );
    const { container } = page();
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${row.draft.title}` }));
    const preTest = container.querySelector<HTMLElement>('[aria-label="Lesson Pre-test"]')!;
    fireEvent.click(preTest.querySelector('summary')!);
    const question = preTest.querySelector<HTMLElement>('.admin-assessment-question')!;
    fireEvent.click(question.querySelector('summary')!);

    fireEvent.click(within(question).getByRole('button', { name: 'Add choice' }));
    fireEvent.change(within(question).getByLabelText('Choice 3'), {
      target: { value: 'C' },
    });
    fireEvent.click(within(question).getAllByRole('radio', { name: 'Correct' })[2]);
    fireEvent.click(within(question).getByRole('button', { name: 'Move choice 3 up' }));
    fireEvent.click(within(question).getByRole('button', { name: 'Remove choice 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(client.rpc).toHaveBeenCalledWith('save_admin_lesson', expect.anything()));
    const saved = client.rpc.mock.calls.find(([name]) => name === 'save_admin_lesson')?.[1] as {
      p_lesson: ManagedLesson['draft'];
    };
    const savedQuestion = saved.p_lesson.assessmentQuestions['pre-test'][0];
    expect(savedQuestion.choices.map((choice) => choice.label)).toEqual(['A', 'C']);
    expect(savedQuestion.correctChoiceId).toBe(savedQuestion.choices[1].id);
  });
  it('keeps test sections and question editors collapsed with count and prompt summaries', async () => {
    const row = item();
    client.rpc.mockResolvedValue({ data: [row], error: null });
    const { container } = page();
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${row.draft.title}` }));

    const preTest = container.querySelector<HTMLElement>('[aria-label="Lesson Pre-test"]')!;
    const postTest = container.querySelector<HTMLElement>('[aria-label="Lesson Post-test"]')!;
    expect(preTest.querySelector('details')).not.toHaveAttribute('open');
    expect(postTest.querySelector('details')).not.toHaveAttribute('open');
    expect(within(preTest).getByText('1 question')).toBeInTheDocument();
    expect(within(postTest).getByText('1 question')).toBeInTheDocument();
    expect(within(preTest).getByText('Required ✓')).toBeInTheDocument();

    fireEvent.click(preTest.querySelector('summary')!);
    const question = preTest.querySelector<HTMLElement>('.admin-assessment-question')!;
    expect(question).not.toHaveAttribute('open');
    expect(within(question).getByText('Question 1')).toBeInTheDocument();
    expect(question.querySelector('.admin-assessment-question__preview')).toHaveTextContent(
      'Question pre-question',
    );
    expect(within(question).getByLabelText('Question text')).not.toBeVisible();
    expect(within(question).getByRole('button', { name: 'Delete question 1' })).toHaveAttribute('title', 'Delete question 1');

    fireEvent.click(question.querySelector('summary')!);
    expect(within(question).getByLabelText('Question text')).toBeVisible();
    expect(within(question).getAllByRole('radio', { name: 'Correct' })[0]).toBeChecked();
    expect(within(question).getByRole('button', { name: 'Move question 1 down' })).toBeVisible();
    expect(within(question).getByRole('button', { name: 'Delete question 1' })).toBeVisible();

    fireEvent.click(postTest.querySelector('summary')!);
    const postRequired = within(postTest).getByRole('checkbox', { name: 'Require lesson post-test' });
    fireEvent.click(postRequired);
    expect(within(postTest).getByText('Optional')).toBeInTheDocument();
    fireEvent.click(postTest.querySelector('summary')!);
    fireEvent.click(postTest.querySelector('summary')!);
    expect(postRequired).not.toBeChecked();
    fireEvent.click(postRequired);
    expect(postTest.querySelector('.admin-assessment-question__preview')).toHaveTextContent('Question post-question');
  });
  it('adds and independently reorders accepted token sequences', async () => {
    const activity = newActivity('organize-translate') as Extract<
      AuthoredLesson['activities'][number],
      { type: 'organize-translate' }
    >;
    activity.tokens = [
      {
        id: 'first',
        label: 'A long token label that needs room to wrap without covering controls',
      },
      { id: 'second', label: 'second token' },
    ];
    activity.correctTokenSequence = ['first', 'second'];
    activity.acceptedTokenSequences = [['first', 'second']];
    const onChange = vi.fn();
    const view = render(<ActivityEditor activity={activity} onChange={onChange} />);

    const order = screen.getByRole('group', { name: 'Accepted answer 1' });
    expect(order.querySelectorAll('.admin-token-order__item')).toHaveLength(2);
    expect(order.querySelector('.admin-token-order__controls')).toBeInTheDocument();
    expect(screen.getByText('Add another answer only when a different token order should also be considered correct.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+ Add accepted answer' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Accepted answer added. Choose a distinct token order, then save the lesson draft.',
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        correctTokenSequence: ['first', 'second'],
        acceptedTokenSequences: [['first', 'second'], ['first', 'second']],
      }),
    );
    const withSecondAnswer = onChange.mock.lastCall?.[0] as typeof activity;
    const user = userEvent.setup();
    view.rerender(<ActivityEditor activity={withSecondAnswer} onChange={onChange} />);
    await user.click(view.getByRole('button', { name: 'Move token 1 in accepted answer 2 down' }));
    expect(view.getByRole('status')).toHaveTextContent('Token moved down in accepted answer 2.');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      correctTokenSequence: ['first', 'second'],
      acceptedTokenSequences: [['first', 'second'], ['second', 'first']],
    }));
    view.rerender(<ActivityEditor activity={{ ...withSecondAnswer, acceptedTokenSequences: [['first', 'second'], ['second', 'first']] }} onChange={onChange} />);
    await user.click(view.getByRole('button', { name: 'Remove answer 1' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      correctTokenSequence: ['second', 'first'],
      acceptedTokenSequences: [['second', 'first']],
    }));
  });
  it('drag-reorders available tokens and an accepted answer independently', () => {
    const activity = newActivity('organize-translate') as Extract<AuthoredLesson['activities'][number], { type: 'organize-translate' }>;
    activity.tokens = [
      { id: 'a', label: 'First' }, { id: 'b', label: 'Second' }, { id: 'c', label: 'Third' },
    ];
    activity.correctTokenSequence = ['a', 'b', 'c'];
    activity.acceptedTokenSequences = [['a', 'b', 'c'], ['b', 'c', 'a']];
    const onChange = vi.fn();
    const view = render(<ActivityEditor activity={activity} onChange={onChange} />);

    dragAfter(screen.getByRole('button', { name: 'Drag token 1 to reorder' }),
      screen.getByRole('button', { name: 'Drag token 2 to reorder' }));
    const reorderedTokens = onChange.mock.lastCall?.[0] as typeof activity;
    expect(reorderedTokens.tokens.map((token) => token.id)).toEqual(['b', 'a', 'c']);
    expect(reorderedTokens.acceptedTokenSequences).toEqual([['a', 'b', 'c'], ['b', 'c', 'a']]);

    view.rerender(<ActivityEditor activity={reorderedTokens} onChange={onChange} />);
    dragAfter(screen.getByRole('button', { name: 'Drag token 1 in accepted answer 2 to reorder' }),
      screen.getByRole('button', { name: 'Drag token 2 in accepted answer 2 to reorder' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      correctTokenSequence: ['a', 'b', 'c'],
      acceptedTokenSequences: [['a', 'b', 'c'], ['c', 'b', 'a']],
    }));
  });
  it('rejects eleven activities in the service before any RPC', async () => {
    const draft = item().draft;
    draft.chapters[0].activities = Array.from({ length: 11 }, () => newActivity('find-word'));
    await expect(saveManagedLesson(draft, 0)).rejects.toThrow('at most 10');
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it('shows readable field guidance when a blank activity blocks publishing', async () => {
    const row = item();
    const blankActivity = newActivity('choose-correct-translation');
    row.draft.activities.push(blankActivity);
    row.draft.chapters[0].activities.push(blankActivity);

    await expect(publishManagedLesson(row, true)).rejects.toThrow(
      `Complete the required fields before publishing. Activity ${row.draft.activities.length}: title, instructions, feedback title, feedback explanation, choice 1 text, choice 2 text.`,
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it('publishes/unpublishes only through the guarded publication RPC', async () => {
    await publishManagedLesson(item(), true);
    await publishManagedLesson(item(), false);
    expect(client.rpc).toHaveBeenCalledWith('set_lesson_publication', {
      p_lesson_id: item().lesson_id,
      p_publish: true,
      p_revision: 1,
    });
    expect(client.rpc).toHaveBeenCalledWith('set_lesson_publication', {
      p_lesson_id: item().lesson_id,
      p_publish: false,
      p_revision: 1,
    });
  });
  it('previews real renderers with no remote calls or local learning writes', async () => {
    const before = await Promise.all(db.tables.map((t) => t.count()));
    const user = userEvent.setup();
    const lesson = item().draft;
    render(<LessonContentPreview lesson={lesson} />);
    expect(screen.getByRole('table', { name: 'Vocabulary' })).toBeVisible();
    expect(document.querySelectorAll('.chapter-teaching__block')).toHaveLength(
      lesson.chapters.reduce(
        (count, chapter) =>
          count + chapter.instructionalContent.length,
        0,
      ),
    );
    const activity = screen
      .getByRole('heading', { name: lesson.activities[0].title })
      .closest('.activity-card')! as HTMLElement;
    await user.click(within(activity).getByRole('radio', { name: 'sum' }));
    await user.click(within(activity).getByRole('button', { name: 'Submit answer' }));
    expect(await screen.findByText(/^Correct\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next activity' }));
    expect(screen.getByText('Activity 2 of 6')).toBeInTheDocument();
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
    expect(await Promise.all(db.tables.map((t) => t.count()))).toEqual(before);
  });
  it('keeps chapter and teaching-content forms collapsed until their summaries are opened', async () => {
    const lesson = normalizeAuthoredLesson(item().draft);
    render(<LessonContentPreview lesson={lesson} />);
    page();
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${lesson.title}` }));

    const chapter = document.querySelector<HTMLElement>('.admin-chapter-details')!;
    expect(chapter).not.toHaveAttribute('open');
    expect(chapter.closest('.admin-chapter')?.querySelector(':scope > legend')).toBeNull();
    expect(chapter.querySelector('summary')).toHaveTextContent(/Chapter 1:.*teaching.*activities/);
    const dragHandle = within(chapter).getByRole('button', { name: 'Drag chapter 1 to reorder' });
    expect(dragHandle).toHaveAttribute('title');
    fireEvent.click(dragHandle);
    expect(chapter).not.toHaveAttribute('open');
    fireEvent.click(within(chapter).getByRole('button', { name: 'Delete chapter 1' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete chapter?' })).toBeVisible();
    expect(chapter).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(chapter).getByText(/Chapter 1:/));
    const teaching = [...document.querySelectorAll<HTMLElement>('.admin-instruction')]
      .find((element) => within(element).queryByLabelText('Teaching content title'))!;
    expect(teaching).not.toHaveAttribute('open');
    expect(within(teaching).getByLabelText('Teaching content title')).not.toBeVisible();
    expect(within(teaching).getByRole('button', { name: /Delete content/ })).toBeVisible();
    fireEvent.click(teaching.querySelector('summary')!);
    expect(within(teaching).getByLabelText('Teaching content title')).toBeVisible();
    expect(within(teaching).getByRole('button', { name: /Delete content/ })).toBeVisible();
  });
  it('keeps activity editors and actions collapsed behind a type/title summary', async () => {
    const row = item();
    client.rpc.mockResolvedValue({ data: [row], error: null });
    const { container } = page();
    fireEvent.click(await screen.findByRole('button', { name: `Edit ${row.draft.title}` }));
    fireEvent.click(container.querySelector('.admin-chapter-details summary')!);

    const activity = container.querySelector<HTMLElement>('.admin-activity')!;
    const summary = within(activity).getByText(/Activity 1 · Find the word/);
    expect(summary).toHaveTextContent(row.draft.activities[0].title);
    expect(activity).not.toHaveAttribute('open');
    expect(within(activity).getByLabelText('Activity title')).not.toBeVisible();
    expect(within(activity).getByRole('button', { name: 'Delete activity 1' })).toHaveAttribute('title', 'Delete activity 1');

    fireEvent.click(summary);
    expect(within(activity).getByLabelText('Activity title')).toBeVisible();
    expect(within(activity).getByRole('button', { name: 'Delete activity 1' })).toBeVisible();
    fireEvent.change(within(activity).getByLabelText('Activity title'), { target: { value: 'Draft edit' } });
    fireEvent.click(activity.querySelector('summary')!);
    fireEvent.click(activity.querySelector('summary')!);
    expect(within(activity).getByLabelText('Activity title')).toHaveValue('Draft edit');
  });
  it.each([false, true])(
    'waits for server admin membership before rendering (allowed=%s)',
    async (allowed) => {
      useAuthStore.setState({
        status: 'authenticated',
        user: {
          id: '10000000-0000-4000-8000-000000000001',
          normalizedUsername: 'author',
          displayName: 'Author',
          createdAt: 1,
          lastLoginAt: 1,
        },
      });
      let resolve!: (value: unknown) => void;
      client.rpc.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      applyExperienceScope('student');
      render(
        <MemoryRouter>
          <AdminRoute>
            <h1>Private editor</h1>
          </AdminRoute>
        </MemoryRouter>,
      );
      expect(screen.queryByText('Private editor')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveClass('loading-state--screen');
      expect(document.documentElement.dataset.experience).toBe('neutral');
      await act(async () => resolve({ data: allowed, error: null }));
      await waitFor(() =>
        expect(
          screen.getByRole('heading', {
            name: allowed ? 'Private editor' : 'Admin access required',
          }),
        ).toBeInTheDocument(),
      );
      expect(client.rpc).toHaveBeenCalledWith('is_admin', undefined);
    },
  );
});
