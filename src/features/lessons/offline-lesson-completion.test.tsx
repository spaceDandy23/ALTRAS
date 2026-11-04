import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import { useLessonDrafts } from './attempts/useLessonDrafts';
import type { AssessmentAttempt, AssessmentDraft, AssessmentKind } from '@/types/assessment';
import type { LessonAttempt } from '@/types/learning';
import { packagedContent } from './content/packaged-content';
import { GlobalLessonSyncStatus } from './components/GlobalLessonSyncStatus';
import { LessonsPage } from './LessonsPage';
import { LessonOverviewPage } from './LessonOverviewPage';
import {
  restartAttempt,
  startOrResumeAttempt,
  syncPendingLessonDrafts,
} from './attempts/attempt.service';
import {
  getLessonDraft,
  discoverPendingLessonDrafts,
  queueLessonAnswer,
  queueLessonStageTransition,
  saveLessonDraft,
  queueLessonActiveTime,
} from './attempts/lesson-draft.service';
import {
  createOfflineAssessmentDraft,
  saveAssessmentDraft,
  submitLocalLessonAssessment,
  updateDraftAnswer,
  discoverPendingAssessmentDrafts,
} from '@/features/assessments/assessment-draft.service';
import { syncPendingAssessmentDrafts } from '@/features/assessments/assessment-sync.service';
import { getLessonProgress } from './progress/progress.service';

const api = vi.hoisted(() => ({
  prepare: vi.fn(),
  restart: vi.fn(),
  advance: vi.fn(),
  answer: vi.fn(),
  finish: vi.fn(),
  time: vi.fn(),
  getLesson: vi.fn(),
  questions: vi.fn(),
  start: vi.fn(),
  read: vi.fn(),
  sync: vi.fn(),
  submitTest: vi.fn(),
  hub: vi.fn(),
  xp: vi.fn(),
}));
vi.mock('./attempts/online-attempt.service', () => ({
  prepareOnlineAttempt: api.prepare,
  restartOnlineAttempt: api.restart,
  advanceOnlineAttemptStage: api.advance,
  submitOnlineActivityAnswer: api.answer,
  completeOnlineAttempt: api.finish,
  recordOnlineActiveSeconds: api.time,
  getOnlineActiveAttempt: vi.fn(),
  getOnlineAttempt: vi.fn(),
}));
vi.mock('./content/content.service', () => ({ getLesson: api.getLesson }));
vi.mock('./progress/progress.service', () => ({
  getLessonHubData: api.hub,
  getTotalXp: api.xp,
  getLessonProgress: vi.fn(),
  ensureUserLessonProgress: vi.fn(),
}));
vi.mock('@/features/assessments/assessment.service', () => ({
  getAssessmentQuestions: api.questions,
  startAssessment: api.start,
  getAssessmentAttempt: api.read,
  syncAssessmentDraft: api.sync,
  completeAssessment: api.submitTest,
}));

const userId = '20000000-0000-4000-8000-000000000002';
const attemptId = '40000000-0000-4000-8000-000000000004';
const base = packagedContent.lessons[0];
const lesson = {
  ...base,
  activities: base.activities.slice(0, 1),
  assessments: { preTest: 'pre-test' as const, postTest: 'post-test' as const },
  chapters: [
    {
      id: 'chapter-one',
      title: 'Chapter one',
      displayOrder: 1,
      instructionalContent: base.instructionalContent,
      activities: base.activities.slice(0, 1),
    },
  ],
};
const question = (assessment: AssessmentKind) => ({
  id: `${assessment}-q`,
  assessment,
  displayOrder: 1,
  prompt: 'Which expression?',
  choices: [
    { id: 'a', label: 'x + 1' },
    { id: 'b', label: 'x - 1' },
  ],
  contentVersion: 1,
  isPlaceholder: false,
});
const initialAttempt = (): LessonAttempt => ({
  id: attemptId,
  userId,
  lessonId: lesson.id,
  contentVersion: lesson.contentVersion,
  status: 'active',
  startedAt: 1,
  lastUpdatedAt: 1,
  completedAt: null,
  abandonedAt: null,
  answers: [],
  finalScore: null,
  starCount: null,
  cleared: null,
  xpImprovement: 0,
  flowStage: 'pre-test',
  currentChapterId: 'chapter-one',
  preAssessmentVersion: 1,
  postAssessmentVersion: 1,
});
const online = (value: boolean) =>
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
let server: LessonAttempt;
let tests: Partial<Record<AssessmentKind, AssessmentAttempt>>;
let events: string[];

beforeEach(async () => {
  await db.lessonDrafts.clear();
  await db.assessmentDrafts.clear();
  Object.values(api).forEach((mock) => mock.mockReset());
  online(true);
  server = initialAttempt();
  tests = {};
  events = [];
  useAuthStore.setState({
    status: 'authenticated',
    user: {
      id: userId,
      normalizedUsername: 'student',
      displayName: 'Student',
      createdAt: 1,
      lastLoginAt: 1,
    },
  });
  useContentStore.setState({ status: 'ready', error: null });
  api.prepare.mockImplementation(async () => ({ attempt: server, mode: 'first' }));
  api.getLesson.mockResolvedValue(lesson);
  api.questions.mockImplementation(async (kind: AssessmentKind) => [question(kind)]);
  api.start.mockImplementation(async (_user, kind: AssessmentKind, _scope, id: string) => {
    if (tests[kind]) return tests[kind];
    if (server.flowStage !== kind) throw new Error('Wrong server stage');
    events.push(`start:${kind}`);
    return (tests[kind] = {
      id,
      userId,
      assessment: kind,
      status: 'active',
      startedAt: 2,
      submittedAt: null,
      score: null,
      completionSeconds: null,
      contentVersion: 1,
      expectedQuestionCount: 1,
      answers: [],
      acceptedRevision: 0,
      acceptedMutationId: null,
      submittedRevision: null,
      lessonId: lesson.id,
      lessonAttemptId: attemptId,
    });
  });
  api.read.mockImplementation(async (_user, kind: AssessmentKind) => tests[kind] ?? null);
  api.sync.mockImplementation(async (draft: AssessmentDraft) => {
    events.push(`answers:${draft.assessment}`);
    return (tests[draft.assessment] = {
      ...tests[draft.assessment]!,
      answers: draft.answers,
      acceptedRevision: draft.revision,
      acceptedMutationId: draft.mutationId,
    });
  });
  api.submitTest.mockImplementation(async (_user, kind: AssessmentKind, _id, revision) => {
    events.push(`submit:${kind}`);
    tests[kind] = {
      ...tests[kind]!,
      status: 'submitted',
      score: 75,
      submittedAt: 3,
      completionSeconds: 10,
      submittedRevision: revision,
    };
    // Supabase accepted the Post-test but its response was lost: status recovery must suffice.
    if (kind === 'post-test') throw new Error('Response lost');
    return tests[kind];
  });
  api.advance.mockImplementation(
    async (_id: string, from: NonNullable<LessonAttempt['flowStage']>) => {
      expect(server.flowStage).toBe(from);
      events.push(`advance:${from}`);
      if (from === 'pre-test' || from === 'post-test')
        expect(tests[from]?.status).toBe('submitted');
      if (from === 'chapter-activity') expect(server.answers).toHaveLength(1);
      const next = {
        'pre-test': 'chapter-teaching',
        'chapter-teaching': 'chapter-activity',
        'chapter-activity': 'post-test',
        'post-test': 'ready-to-complete',
      } as const;
      server = { ...server, flowStage: next[from as keyof typeof next] };
      return server;
    },
  );
  api.answer.mockImplementation(async (_db, _id, activityId, answer) => {
    expect(server.flowStage).toBe('chapter-activity');
    events.push('activity');
    server = {
      ...server,
      answers: [
        {
          activityId,
          activityType: lesson.activities[0].type,
          answer,
          isCorrect: true,
          submittedAt: 3,
        },
      ],
    };
    return server;
  });
  api.time.mockResolvedValue(undefined);
  api.xp.mockResolvedValue(60);
  vi.mocked(getLessonProgress).mockResolvedValue({
    id: `${userId}:${lesson.id}`,
    userId,
    lessonId: lesson.id,
    status: 'in-progress',
    bestScore: 0,
    bestStarCount: 0,
    attemptCount: 0,
    xpAwarded: 0,
    firstStartedAt: 1,
    lastAttemptedAt: 1,
    clearedAt: null,
  });
  api.hub.mockResolvedValue({
    section: packagedContent.sections[0],
    unit: packagedContent.units[0],
    entries: [
      {
        lesson,
        progress: {
          id: `${userId}:${lesson.id}`,
          userId,
          lessonId: lesson.id,
          status: 'in-progress',
          bestScore: 0,
          bestStarCount: 0,
          attemptCount: 0,
          xpAwarded: 0,
          firstStartedAt: 1,
          lastAttemptedAt: null,
          clearedAt: null,
        },
      },
    ],
  });
});

afterEach(async () => {
  cleanup();
  await db.lessonDrafts.clear();
  await db.assessmentDrafts.clear();
  online(true);
  useAuthStore.setState({ status: 'guest', user: null });
  useContentStore.setState({ status: 'idle', error: null });
});

async function finishLocally() {
  await startOrResumeAttempt(db, userId, lesson.id);
  online(false);
  const answerTest = async (kind: AssessmentKind) => {
    const draft = updateDraftAnswer(
      createOfflineAssessmentDraft(userId, kind, lesson.id, attemptId, [question(kind)]),
      `${kind}-q`,
      'a',
    );
    await saveAssessmentDraft(draft);
    await submitLocalLessonAssessment(draft);
  };
  await answerTest('pre-test');
  let saved = (await getLessonDraft(userId, lesson.id, attemptId))!;
  await queueLessonStageTransition(saved.id);
  saved = (await getLessonDraft(userId, lesson.id, attemptId))!;
  const activity = lesson.activities[0];
  await saveLessonDraft(
    queueLessonAnswer(
      saved,
      activity.id,
      activity.type,
      activity.type === 'find-word'
        ? activity.choices[0].id
        : activity.tokens.map((token) => token.id),
      0,
    ),
  );
  await queueLessonStageTransition(saved.id);
  await queueLessonActiveTime(saved.id, 12);
  await answerTest('post-test');
  return (await getLessonDraft(userId, lesson.id, attemptId))!;
}

it('keeps completion pending after a lost final response and confirms it on retry without awarding twice', async () => {
  await finishLocally();
  online(true);
  let rewards = 0;
  api.finish.mockImplementation(async () => {
    if (server.status === 'completed') return server;
    rewards++;
    server = {
      ...server,
      status: 'completed',
      finalScore: 75,
      starCount: 2,
      cleared: true,
      xpImprovement: 60,
      completedAt: 4,
    };
    throw new Error('Final response lost');
  });
  expect(await syncPendingLessonDrafts(userId)).toMatchObject({ failed: 1, pending: 1 });
  expect(await getLessonDraft(userId, lesson.id, attemptId)).toMatchObject({
    pendingCompletion: true,
    attempt: { finalScore: null },
  });
  await expect(restartAttempt(db, userId, lesson.id)).rejects.toThrow('Results pending sync');
  expect(await syncPendingLessonDrafts(userId)).toMatchObject({ failed: 0, pending: 0 });
  expect(rewards).toBe(1);
  expect(api.answer).toHaveBeenCalledOnce();
  expect(api.time).toHaveBeenCalledOnce();
  expect(await getLessonDraft(userId, lesson.id, attemptId)).toMatchObject({
    pendingCompletion: false,
    attempt: { status: 'completed', finalScore: 75 },
  });
});

it.each(['hub', 'detail'] as const)(
  'finishes the entire cached lesson offline and refreshes %s after reconnect without reopening',
  async (page) => {
    const pending = await finishLocally();
    expect(pending).toMatchObject({
      pendingCompletion: true,
      attempt: { status: 'active', finalScore: null, starCount: null, xpImprovement: 0 },
    });
    expect(events).toEqual([]);
    await expect(restartAttempt(db, userId, lesson.id)).rejects.toThrow('Results pending sync');
    await expect(startOrResumeAttempt(db, userId, lesson.id)).rejects.toThrow(
      'Results pending sync',
    );
    expect(api.restart).not.toHaveBeenCalled();
    let confirm!: () => void;
    const confirmation = new Promise<void>((resolve) => {
      confirm = resolve;
    });
    api.finish.mockImplementation(async () => {
      expect(server.flowStage).toBe('ready-to-complete');
      await confirmation;
      events.push('complete');
      server = {
        ...server,
        status: 'completed',
        finalScore: 75,
        starCount: 2,
        cleared: true,
        xpImprovement: 60,
        completedAt: 4,
      };
      return server;
    });
    const workspace = (
      <MemoryRouter initialEntries={[page === 'hub' ? '/lessons' : `/lessons/${lesson.id}`]}>
        <GlobalLessonSyncStatus userId={userId} />
        <Routes>
          <Route path="/lessons" element={<LessonsPage />} />
          <Route path="/lessons/:lessonId" element={<LessonOverviewPage />} />
        </Routes>
      </MemoryRouter>
    );
    const mounted = render(workspace);
    expect(await screen.findByText('Results pending sync')).toBeVisible();
    mounted.unmount();
    // A reload creates fresh page/scheduler instances; only Dexie retains pending work.
    render(workspace);
    expect(await screen.findByText('Results pending sync')).toBeVisible();
    expect(screen.queryByText('Score 75%')).toBeNull();
    if (page === 'detail') expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled();
    act(() => {
      online(true);
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(api.finish).toHaveBeenCalledOnce());
    expect(screen.getByText('Results pending sync')).toBeVisible();
    await act(async () => confirm());
    expect(await screen.findByText('View Results')).toBeVisible();
    expect(screen.getByText('Score 75%')).toBeVisible();
    expect(screen.queryByText('Results pending sync')).toBeNull();
    if (page === 'detail') expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await syncPendingLessonDrafts(userId);
    expect(api.finish).toHaveBeenCalledOnce();
    expect(api.time).toHaveBeenCalledOnce();
    expect(events).toEqual([
      'start:pre-test',
      'answers:pre-test',
      'submit:pre-test',
      'advance:pre-test',
      'advance:chapter-teaching',
      'activity',
      'advance:chapter-activity',
      'start:post-test',
      'answers:post-test',
      'submit:post-test',
      'advance:post-test',
      'complete',
    ]);
    expect(await db.assessmentDrafts.count()).toBe(0);
    expect(await getLessonDraft(userId, lesson.id, attemptId)).toMatchObject({
      pendingCompletion: false,
      pendingActiveTimeSegments: [],
      attempt: { status: 'completed', finalScore: 75 },
    });
    const fresh = { ...initialAttempt(), id: '40000000-0000-4000-8000-000000000009', startedAt: 5 };
    api.restart.mockResolvedValue(fresh);
    await restartAttempt(db, userId, lesson.id);
    expect(await getLessonDraft(userId, lesson.id, fresh.id)).toMatchObject({
      pendingCompletion: false,
      pendingStageTransitions: [],
      attempt: { answers: [], flowStage: 'pre-test' },
    });
  },
);

function SessionWorkspace() {
  const user = useAuthStore((state) => state.user);
  const drafts = useLessonDrafts(user?.id);
  if (!user) return <p>Signed out</p>;
  return (
    <>
      <GlobalLessonSyncStatus key={user.id} userId={user.id} />
      <p>
        {user.id}: {drafts === undefined ? 'loading drafts' : `${drafts.size} saved lessons`}
      </p>
    </>
  );
}

it.each(['start', 'answer', 'finish'] as const)(
  'keeps A drafts private and resumes after logout during %s, ignoring the old acknowledgement',
  async (phase) => {
    const pending = await finishLocally();
    const owner = useAuthStore.getState().user!;
    const other = { ...owner, id: '20000000-0000-4000-8000-000000000099' };
    api.finish.mockImplementation(async () => {
      server = {
        ...server,
        status: 'completed',
        finalScore: 75,
        starCount: 2,
        cleared: true,
        xpImprovement: 60,
        completedAt: 4,
      };
      return server;
    });
    let release!: () => void;
    let reached!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const original = api[phase].getMockImplementation()!;
    api[phase].mockImplementationOnce(async (...args: unknown[]) => {
      const accepted = await original(...args);
      reached();
      await held;
      return accepted;
    });
    online(true);
    render(<SessionWorkspace />);
    await started;
    const beforeLogout = await db.lessonDrafts.get(pending.id);
    const assessmentCount = await db.assessmentDrafts.count();
    act(() => useAuthStore.setState({ status: 'guest', user: null }));
    expect(screen.getByText('Signed out')).toBeVisible();
    act(() => useAuthStore.setState({ status: 'authenticated', user: other }));
    expect(await screen.findByText(`${other.id}: 0 saved lessons`)).toBeVisible();
    expect((await discoverPendingLessonDrafts(other.id)).drafts).toEqual([]);
    expect((await discoverPendingAssessmentDrafts(other.id)).drafts).toEqual([]);
    await expect(syncPendingLessonDrafts(userId)).rejects.toThrow('Progress sync paused');
    await expect(syncPendingAssessmentDrafts(userId)).rejects.toThrow('Progress sync paused');
    await act(async () => release());
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(await db.lessonDrafts.get(pending.id)).toEqual(beforeLogout);
    expect(await db.assessmentDrafts.count()).toBe(assessmentCount);
    expect(screen.queryByText(`${other.id}: 1 saved lessons`)).toBeNull();
    // The old response cannot consume A's pending intent, even if A signs in again.
    act(() => useAuthStore.setState({ status: 'guest', user: null }));
    act(() => useAuthStore.setState({ status: 'authenticated', user: owner }));
    await waitFor(async () =>
      expect(await db.lessonDrafts.get(pending.id)).toMatchObject({
        pendingCompletion: false,
        attempt: { status: 'completed', finalScore: 75 },
      }),
    );
    expect(await db.assessmentDrafts.count()).toBe(0);
    expect(api.time).toHaveBeenCalledOnce();
  },
);

it('pauses after connectivity is lost mid-assessment replay and resumes without duplicate accepted answers', async () => {
  const pending = await finishLocally();
  const original = api.sync.getMockImplementation()!;
  api.sync.mockImplementationOnce(async (...args: unknown[]) => {
    await original(...args);
    online(false);
    window.dispatchEvent(new Event('offline'));
    throw new Error('Connection lost after acceptance');
  });
  api.finish.mockImplementation(async () => {
    server = {
      ...server,
      status: 'completed',
      finalScore: 75,
      starCount: 2,
      cleared: true,
      xpImprovement: 60,
      completedAt: 4,
    };
    return server;
  });
  online(true);
  render(<SessionWorkspace />);
  await waitFor(() => expect(api.sync).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Progress saved on this device'),
  );
  expect(api.submitTest).not.toHaveBeenCalled();
  expect((await db.lessonDrafts.get(pending.id))?.pendingCompletion).toBe(true);
  act(() => {
    online(true);
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
  });
  await waitFor(async () =>
    expect(await db.lessonDrafts.get(pending.id)).toMatchObject({
      pendingCompletion: false,
      attempt: { finalScore: 75 },
    }),
  );
  expect(events.filter((event) => event === 'answers:pre-test')).toHaveLength(1);
  expect(api.answer).toHaveBeenCalledOnce();
  expect(api.finish).toHaveBeenCalledOnce();
  expect(api.time).toHaveBeenCalledOnce();
});
