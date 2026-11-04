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

describe('Basic Lesson Management editor and preview', () => {
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
  it('blocks activity eleven in the editor', async () => {
    const row = item();
    row.draft.chapters[0].activities = Array.from({ length: 9 }, () => newActivity('find-word'));
    row.draft = normalizeAuthoredLesson(row.draft);
    client.rpc.mockResolvedValue({ data: [row], error: null });
    const { container } = page();
    fireEvent.click(await screen.findByText(`Edit ${row.draft.title}`, { selector: 'button' }));
    fireEvent.click(container.querySelector('.admin-chapter-details summary')!);
    const add = screen.getByText('Add activity to Chapter 1', { selector: 'button' });
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
    expect(screen.getByRole('group', { name: 'Correct token order' })).toBeInTheDocument();
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

    fireEvent.click(preTest.querySelector('summary')!);
    const question = preTest.querySelector<HTMLElement>('.admin-assessment-question')!;
    expect(question).not.toHaveAttribute('open');
    expect(within(question).getByText('Question 1')).toBeInTheDocument();
    expect(question.querySelector('.admin-assessment-question__preview')).toHaveTextContent(
      'Question pre-question',
    );
    expect(within(question).getByLabelText('Question text')).not.toBeVisible();
    expect(within(question).getByRole('button', { name: 'Delete question 1' })).not.toBeVisible();

    fireEvent.click(question.querySelector('summary')!);
    expect(within(question).getByLabelText('Question text')).toBeVisible();
    expect(within(question).getAllByRole('radio', { name: 'Correct' })[0]).toBeChecked();
    expect(within(question).getByRole('button', { name: 'Move question 1 down' })).toBeVisible();
    expect(within(question).getByRole('button', { name: 'Delete question 1' })).toBeVisible();
  });
  it('keeps correct-token rows distinct while preserving token reordering', async () => {
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
    const onChange = vi.fn();
    render(<ActivityEditor activity={activity} onChange={onChange} />);

    const order = screen.getByRole('group', { name: 'Correct token order' });
    expect(order.querySelectorAll('.admin-token-order__item')).toHaveLength(2);
    expect(order.querySelector('.admin-token-order__controls')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Move correct token 1 down' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ correctTokenSequence: ['second', 'first'] }),
    );
  });
  it('rejects eleven activities in the service before any RPC', async () => {
    const draft = item().draft;
    draft.chapters[0].activities = Array.from({ length: 11 }, () => newActivity('find-word'));
    await expect(saveManagedLesson(draft, 0)).rejects.toThrow('at most 10');
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
    render(<LessonContentPreview lesson={item().draft} />);
    expect(document.querySelectorAll('.chapter-teaching__block')).toHaveLength(
      item().draft.chapters.reduce((count, chapter) => count + chapter.instructionalContent.length, 0),
    );
    const activity = screen
      .getByRole('heading', { name: item().draft.activities[0].title })
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
    fireEvent.click(within(chapter).getByText(/Chapter 1:/));
    const teaching = document.querySelector<HTMLElement>('.admin-instruction')!;
    expect(teaching).not.toHaveAttribute('open');
    expect(within(teaching).getByLabelText('Teaching content title')).not.toBeVisible();
    expect(within(teaching).getByRole('button', { name: 'Delete content 1' })).not.toBeVisible();
    fireEvent.click(within(teaching).getByText(/Content 1/));
    expect(within(teaching).getByLabelText('Teaching content title')).toBeVisible();
    expect(within(teaching).getByRole('button', { name: 'Delete content 1' })).toBeVisible();
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
    expect(within(activity).getByRole('button', { name: 'Delete activity 1' })).not.toBeVisible();

    fireEvent.click(summary);
    expect(within(activity).getByLabelText('Activity title')).toBeVisible();
    expect(within(activity).getByRole('button', { name: 'Delete activity 1' })).toBeVisible();
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
