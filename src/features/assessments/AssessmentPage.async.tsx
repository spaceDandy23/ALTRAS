import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { captureSyncSession, requireSyncSession } from '@/services/sync-session';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingState';
import { CharacterAssistant } from '@/features/characters/components/CharacterAssistant';
import { resolveCharacterDialogue } from '@/features/characters/character.dialogue';
import { cancelPendingResultSfx, playCompletion, playReward } from '@/services/audio/audio.manager';
import {
  playNeutralClickOnKeyDown,
  playNeutralClickOnPointerDown,
} from '@/services/audio/click.handlers';
import { useAuthStore } from '@/stores/auth.store';
import { db } from '@/db/database';
import {
  flushPendingLessonAttempt,
  queueAttemptStageTransition,
} from '@/features/lessons/attempts/attempt.service';
import {
  assessmentKindSchema,
  assessmentQuestionSchema,
  type AssessmentKind,
  type AssessmentAttempt,
  type AssessmentDraft,
  type AssessmentQuestion,
} from '@/types/assessment';
import {
  AssessmentDraftSynchronizer,
  acknowledgeAssessmentStart,
  createAssessmentDraft,
  createOfflineAssessmentDraft,
  deleteAssessmentDraft,
  draftToAttempt,
  getAssessmentDraft,
  markDraftPendingSubmission,
  reconcileAssessmentDraft,
  replaceAssessmentDraft,
  saveAssessmentDraft,
  submitLocalLessonAssessment,
  updateDraftAnswer,
  updateDraftPosition,
  validateLocalDraft,
} from './assessment-draft.service';
import { flushPendingAssessmentDraft } from './assessment-sync.service';
import {
  getCachedLessonAssessmentQuestions,
  getLessonDraft,
} from '@/features/lessons/attempts/lesson-draft.service';
import { LessonElapsedTimer } from '@/features/lessons/components/LessonElapsedTimer';
import {
  completeAssessment,
  getAssessmentAttempt,
  getAssessmentQuestions,
  startAssessment,
  syncAssessmentDraft,
  type AssessmentScope,
} from './assessment.service';

const duration = (seconds: number) =>
  seconds < 60 ? `${seconds} sec` : `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
type SyncNotice = 'none' | 'offline' | 'pending' | 'syncing' | 'conflict';

export function AssessmentPage() {
  const { kind: kindParam, lessonId, attemptId } = useParams();
  const parsedKind = assessmentKindSchema.safeParse(kindParam ?? '');
  const kind = parsedKind.success ? parsedKind.data : null;
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const navigate = useNavigate();
  const scope = useMemo(
    () => (lessonId && attemptId ? { lessonId, lessonAttemptId: attemptId } : undefined),
    [attemptId, lessonId],
  );
  const initialQuestions = useMemo(() => {
    if (!kind || !lessonId || !attemptId || !location.state || typeof location.state !== 'object')
      return undefined;
    const state = location.state as Record<string, unknown>;
    if (
      state.lessonId !== lessonId ||
      state.attemptId !== attemptId ||
      state.assessment !== kind
    )
      return undefined;
    const parsed = z.array(assessmentQuestionSchema).safeParse(state.questions);
    return parsed.success && parsed.data.length > 0 && parsed.data.every((q) => q.assessment === kind)
      ? parsed.data
      : undefined;
  }, [attemptId, kind, lessonId, location.state]);
  useEffect(() => {
    if (!initialQuestions) return;
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: null,
    });
  }, [initialQuestions, location.hash, location.pathname, location.search, navigate]);
  if (!kind)
    return (
      <section className="assessment-shell assessment-state panel">
        <h1>Assessment not found</h1>
        <Link to="/">Return home</Link>
      </section>
    );
  if (!user) return <LoadingState variant="page" />;
  return (
    <AssessmentSession
      key={`${user.id}:${kind}:${scope?.lessonAttemptId ?? 'global'}`}
      userId={user.id}
      kind={kind}
      scope={scope}
      initialQuestions={initialQuestions}
    />
  );
}

function AssessmentSession({
  userId,
  kind,
  scope,
  initialQuestions,
}: {
  userId: string;
  kind: AssessmentKind;
  scope?: AssessmentScope;
  initialQuestions?: AssessmentQuestion[];
}) {
  const navigate = useNavigate();
  const localLessonAssessment = Boolean(scope);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>(initialQuestions ?? []);
  const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null);
  const [draft, setDraft] = useState<AssessmentDraft | null>(null);
  const [loading, setLoading] = useState(!initialQuestions?.length);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncNotice, setSyncNotice] = useState<SyncNotice>('none');
  const [error, setError] = useState('');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [bootstrapError, setBootstrapError] = useState('');
  const [reload, setReload] = useState(0);
  const [durability, setDurability] = useState<'saving' | 'saved' | 'failed'>('saved');
  const [connectionOnline, setConnectionOnline] = useState(() => navigator.onLine);
  const [completionWarning, setCompletionWarning] = useState('');
  const [lessonStartedAt, setLessonStartedAt] = useState<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const updateConnection = () => setConnectionOnline(navigator.onLine);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);
  const draftRef = useRef<AssessmentDraft | null>(null);
  const synchronizerRef = useRef<AssessmentDraftSynchronizer | null>(null);
  const localSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const submissionInFlightRef = useRef(false);

  const applyDraft = useCallback((next: AssessmentDraft | null) => {
    const current = draftRef.current;
    if (next && current?.id === next.id && current.syncStatus === 'pending_submission') {
      next = { ...next, syncStatus: 'pending_submission' };
    }
    draftRef.current = next;
    setDraft(next);
    if (next) setAttempt(draftToAttempt(next));
  }, []);
  const persist = useCallback(
    (next: AssessmentDraft, shouldSync: boolean) => {
      applyDraft(next);
      setDurability('saving');
      localSaveQueueRef.current = localSaveQueueRef.current
        .catch(() => undefined)
        .then(() => saveAssessmentDraft(next))
        .then(() => {
          if (mounted.current && draftRef.current?.revision === next.revision)
            setDurability('saved');
        })
        .catch((cause: unknown) => {
          if (mounted.current) setDurability('failed');
          throw cause;
        });
      // In-memory answers remain the sync source even if IndexedDB is unavailable.
      void localSaveQueueRef.current
        .catch(() => undefined)
        .then(() => {
          if (mounted.current && shouldSync) synchronizerRef.current?.requestSync();
        });
      return localSaveQueueRef.current;
    },
    [applyDraft],
  );

  useEffect(() => {
    let active = true;
    localSaveQueueRef.current = Promise.resolve();
    const load = async () => {
      if (scope) {
        const [local, cached] = await Promise.all([
          getAssessmentDraft(userId, kind, db, scope.lessonAttemptId),
          getLessonDraft(userId, scope.lessonId, scope.lessonAttemptId),
        ]);
        if (!active) return;
        setLessonStartedAt(cached?.attempt.startedAt ?? null);
        if (local) {
          if (local.syncStatus === 'pending_submission') {
            await submitLocalLessonAssessment(local);
            if (!active) return;
          }
          setQuestions(local.questions);
          applyDraft(local);
          setQuestionIndex(local.currentQuestionIndex);
          setSyncNotice(local.syncStatus === 'synced' ? 'none' : 'pending');
          return;
        }
        const cachedQuestions = cached?.assessmentQuestions[kind];
        if (cached?.attempt.flowStage === kind && cachedQuestions?.length) {
          setQuestions(cachedQuestions);
          setAttempt(null);
          return;
        }
      }
      return Promise.allSettled([
        getAssessmentQuestions(kind, scope),
        getAssessmentAttempt(userId, kind, scope),
        getAssessmentDraft(userId, kind, db, scope?.lessonAttemptId),
        scope
          ? getCachedLessonAssessmentQuestions(userId, scope.lessonId, scope.lessonAttemptId, kind)
          : Promise.resolve([]),
      ]).then(async ([questionsResult, attemptResult, localResult, cachedQuestionsResult]) => {
        if (!active) return;
        if (localResult.status === 'rejected')
          throw new Error('Unable to read the local test draft. Please retry.');
        const local = localResult.value;
        const remoteQuestions =
          questionsResult.status === 'fulfilled' ? questionsResult.value : [];
        const cachedQuestions =
          local?.questions.length
            ? local.questions
            : cachedQuestionsResult.status === 'fulfilled' ? cachedQuestionsResult.value : [];
        const loadedQuestions = remoteQuestions.length > 0 ? remoteQuestions : cachedQuestions;
        const server = attemptResult.status === 'fulfilled' ? attemptResult.value : null;
        if (
          server &&
          (server.userId !== userId ||
            server.assessment !== kind ||
            (server.lessonAttemptId ?? undefined) !== scope?.lessonAttemptId)
        )
          throw new Error('The test belongs to another session.');
        // A validated local draft carries the immutable question snapshot for
        // this attempt. Remote question loading may legitimately fail while
        // offline, so only fail when neither source supplied usable content.
        if (loadedQuestions.length === 0)
          throw new Error('Unable to load the test questions. Please retry.');
        if (server?.status === 'submitted') {
          if (
            local &&
            local.attemptId === server.id &&
            local.revision === server.submittedRevision &&
            local.mutationId === server.acceptedMutationId
          ) {
            try {
              await deleteAssessmentDraft(local.id, local.revision, local.mutationId);
            } catch {
              if (active)
                setCompletionWarning(
                  'Your official result is saved, but the local draft could not be cleared.',
                );
            }
          } else if (local)
            setCompletionWarning(
              'Your official result is saved. A different local revision has been kept on this device.',
            );
          if (!active) return;
          setQuestions(loadedQuestions);
          setAttempt(server);
          applyDraft(null);
        } else if (server) {
          const reconciled = reconcileAssessmentDraft(server, local, loadedQuestions);
          setQuestions(reconciled.questions);
          await persist(reconciled, false).catch(() => undefined);
          if (!active) return;
          setQuestionIndex(
            Math.min(reconciled.currentQuestionIndex, Math.max(reconciled.questions.length - 1, 0)),
          );
        } else if (local) {
          if (attemptResult.status === 'fulfilled')
            throw new Error('The saved local attempt could not be confirmed. Please retry online.');
          validateLocalDraft(local, userId, kind);
          setQuestions(local.questions);
          applyDraft({ ...local, mutationId: local.mutationId ?? crypto.randomUUID() });
          setQuestionIndex(
            Math.max(0, Math.min(local.currentQuestionIndex, local.questions.length - 1)),
          );
          setSyncNotice(navigator.onLine ? 'pending' : 'offline');
        } else {
          if (attemptResult.status === 'rejected') throw attemptResult.reason;
          if (loadedQuestions.length === 0) {
            if (questionsResult.status === 'rejected') throw questionsResult.reason;
            throw new Error(
              `No questions are available for this ${kind} in the lesson's pinned assessment version.`,
            );
          }
          for (const question of loadedQuestions) {
            assessmentQuestionSchema.parse(question);
            if (question.assessment !== kind)
              throw new Error('The test questions do not match this assessment.');
          }
          setQuestions(loadedQuestions);
          setAttempt(null);
        }
      });
    };
    void load()
      .catch((cause: unknown) => {
        if (active)
          setBootstrapError(
            cause instanceof Error ? cause.message : 'Unable to load this test. Please retry.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyDraft, persist, kind, userId, reload, scope]);

  const draftId = draft?.id;
  useEffect(() => {
    // Lesson assessments are replayed by the shared app worker, including while this page is open.
    if (localLessonAssessment || !draftId || loading || bootstrapError) return;
    const isCurrent = captureSyncSession(userId);
    const check = () => requireSyncSession(isCurrent);
    let active = true;
    const synchronizer = new AssessmentDraftSynchronizer({
      isCurrent,
      attemptId: draftRef.current?.attemptId,
      load: async () => {
        await localSaveQueueRef.current.catch(() => undefined);
        const current = draftRef.current;
        return current?.id === draftId ? current : null;
      },
      read: () => getAssessmentAttempt(userId, kind, scope),
      start: (current) => startAssessment(userId, kind, scope, current.attemptId, check),
      acknowledgeStart: async (snapshot, server) => {
        await localSaveQueueRef.current;
        if (!active || !isCurrent()) return;
        const next = await acknowledgeAssessmentStart(snapshot, server);
        if (active && isCurrent()) applyDraft(next);
      },
      sync: (current) => syncAssessmentDraft(current, check),
      beforeSync: async (snapshot) => {
        const current = draftRef.current;
        if (!active || !current || !snapshot.mutationId) return;
        await persist(
          {
            ...current,
            pendingSnapshot: { revision: snapshot.revision, mutationId: snapshot.mutationId },
          },
          false,
        ).catch(() => undefined);
      },
      complete: (current) =>
        completeAssessment(
          userId,
          kind,
          current.attemptId,
          current.revision,
          scope,
          check,
          current.answeringSeconds ?? 0,
        ),
      acknowledge: async (snapshot) => {
        const current = draftRef.current;
        if (!active || !current || current.id !== snapshot.id) return;
        const acknowledged = {
          ...current,
          pendingSnapshot: undefined,
          syncedRevision: Math.max(current.syncedRevision, snapshot.revision),
          syncStatus:
            current.syncStatus === 'pending_submission'
              ? ('pending_submission' as const)
              : current.revision === snapshot.revision
                ? ('synced' as const)
                : ('pending' as const),
        };
        await persist(acknowledged, false).catch(() => undefined);
      },
      onCompleted: async (snapshot, completed) => {
        if (!active || !isCurrent()) return;
        if (
          completed.id !== snapshot.attemptId ||
          completed.userId !== userId ||
          completed.assessment !== kind ||
          completed.status !== 'submitted'
        )
          throw new Error('Unable to confirm this result.');
        await localSaveQueueRef.current.catch(() => undefined);
        if (!active || !isCurrent()) return;
        let cleared = false;
        if (
          completed.submittedRevision === snapshot.revision &&
          completed.acceptedMutationId === snapshot.mutationId
        ) {
          try {
            cleared = await deleteAssessmentDraft(
              snapshot.id,
              snapshot.revision,
              snapshot.mutationId,
            );
          } catch {
            /* Keep the authoritative result and report failed cleanup. */
          }
        }
        if (!active || !isCurrent()) return;
        if (!cleared)
          setCompletionWarning(
            'Your official result is saved. An unconfirmed local draft has been kept on this device.',
          );
        applyDraft(null);
        setAttempt(completed);
        setSubmitting(false);
        setSyncNotice('none');
      },
      onStatus: (status) => {
        if (!active) return;
        if (status === 'synced') setSyncNotice('none');
        if (status === 'syncing') setSyncNotice('syncing');
        if (status === 'conflict') {
          setSyncNotice('conflict');
          setSubmitting(false);
        }
        if (status === 'pending') setSyncNotice(navigator.onLine ? 'pending' : 'offline');
      },
    });
    synchronizerRef.current = synchronizer;
    if (draftRef.current?.syncStatus !== 'synced') synchronizer.requestSync();
    const retry = () => synchronizer.requestSync();
    const retryVisible = () => {
      if (document.visibilityState === 'visible') synchronizer.requestSync();
    };
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    document.addEventListener('visibilitychange', retryVisible);
    return () => {
      active = false;
      synchronizer.dispose();
      if (synchronizerRef.current === synchronizer) synchronizerRef.current = null;
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', retry);
      document.removeEventListener('visibilitychange', retryVisible);
    };
  }, [
    applyDraft,
    persist,
    draftId,
    kind,
    userId,
    loading,
    bootstrapError,
    scope,
    localLessonAssessment,
  ]);

  const title = kind === 'pre-test' ? 'Pre-test' : 'Post-test';
  const waitingForConnection =
    !navigator.onLine || syncNotice === 'offline' || syncNotice === 'pending';
  const placeholders = useMemo(
    () => questions.some((question) => question.isPlaceholder),
    [questions],
  );
  if (loading)
    return (
      <div className="assessment-loading-with-timer lesson-timer-host">
        <LessonElapsedTimer startedAt={lessonStartedAt} />
        <LoadingState variant="page" message={`Preparing the ${title.toLowerCase()}…`} />
      </div>
    );
  if (bootstrapError)
    return (
      <section className="assessment-shell assessment-state panel lesson-timer-host">
        <p className="assessment-kicker">{title}</p>
        <LessonElapsedTimer startedAt={lessonStartedAt} />
        <h1>We couldn&rsquo;t load this test</h1>
        <p role="alert">{bootstrapError}</p>
        <div className="result-actions">
          <Button
            onClick={() => {
              setLoading(true);
              setBootstrapError('');
              setReload((value) => value + 1);
            }}
          >
            Try again
          </Button>
          <Link className="button button--secondary" to={scope ? `/lessons/${scope.lessonId}` : '/'}>
            {scope ? 'Return to lesson' : 'Return home'}
          </Link>
        </div>
      </section>
    );
  if (attempt?.status === 'submitted')
    return (
      <>
        <AssessmentResult
          title={title}
          kind={kind}
          attempt={attempt}
          lessonStartedAt={lessonStartedAt}
          continueLesson={
            scope
              ? async () => {
                  await queueAttemptStageTransition(
                    userId,
                    scope.lessonId,
                    scope.lessonAttemptId,
                    kind,
                  );
                  if (kind === 'post-test')
                    await flushPendingLessonAttempt(
                      userId,
                      scope.lessonId,
                      scope.lessonAttemptId,
                    );
                  const destination =
                    kind === 'post-test'
                      ? `/lessons/${scope.lessonId}/result/${scope.lessonAttemptId}`
                      : `/lessons/${scope.lessonId}/play/${scope.lessonAttemptId}`;
                  navigate(destination, { replace: true });
                }
              : undefined
          }
        />
        {completionWarning && <p role="status">{completionWarning}</p>}
      </>
    );
  if (draft?.syncStatus === 'pending_submission') {
    if (localLessonAssessment && navigator.onLine && submitting) {
      return (
        <LoadingState
          variant="page"
          message={
            kind === 'post-test'
              ? 'Submitting your Post-test…'
              : 'Confirming your official result…'
          }
        />
      );
    }
    if (localLessonAssessment && scope) {
      return (
        <section className="assessment-shell assessment-state panel lesson-timer-host">
          <p className="assessment-kicker">{title}</p>
          <LessonElapsedTimer startedAt={lessonStartedAt} />
          <h1>{connectionOnline ? 'Submission saved' : 'Answers saved on this device'}</h1>
          {!connectionOnline && (
            <p role="status">
              {kind === 'post-test'
                ? 'Your answers are saved on this device. Your results will be available once you’re back online.'
                : 'You can continue your lesson. Your official result will be available once your answers sync.'}
            </p>
          )}
          {error && (!localLessonAssessment || !connectionOnline) && <p role="alert">{error}</p>}
          <div className="result-actions">
            <Button
              onClick={() => {
                navigate(
                  kind === 'post-test'
                    ? `/lessons/${scope.lessonId}`
                    : `/lessons/${scope.lessonId}/play/${scope.lessonAttemptId}`,
                  {
                    replace: true,
                  },
                );
              }}
              disabled={submitting || durability !== 'saved'}
            >
              {kind === 'post-test' ? 'Return to lesson' : 'Continue Lesson'}
            </Button>
          </div>
        </section>
      );
    }
    return (
      <section className="assessment-shell assessment-state panel lesson-timer-host">
        <p className="assessment-kicker">{title}</p>
        <LessonElapsedTimer startedAt={lessonStartedAt} />
        <h1>Submission saved</h1>
        <LoadingState
          variant="page"
          message={
            waitingForConnection
              ? 'Submission is pending. It is saved on this device. Reconnect to confirm your result.'
              : 'Confirming your saved result…'
          }
        />
        <div className="result-actions">
          <Link className="button button--secondary" to={scope ? `/lessons/${scope.lessonId}` : '/'}>
            {scope ? 'Return to lesson' : 'Return home'}
          </Link>
        </div>
      </section>
    );
  }

  const begin = async () => {
    if (starting) return;
    setStarting(true);
    setError('');
    try {
      if (localLessonAssessment && scope) {
        const next = createOfflineAssessmentDraft(
          userId,
          kind,
          scope.lessonId,
          scope.lessonAttemptId,
          questions,
        );
        await saveAssessmentDraft(next);
        if (mounted.current) {
          applyDraft(next);
          setQuestionIndex(0);
          setSyncNotice('pending');
        }
        return;
      }
      if (!navigator.onLine) throw new Error('Connect to the internet to start this test.');
      const created = await startAssessment(userId, kind, scope);
      if (!mounted.current) return;
      if (
        created.userId !== userId ||
        created.assessment !== kind ||
        (created.lessonAttemptId ?? undefined) !== scope?.lessonAttemptId
      )
        throw new Error('The test belongs to another session.');
      if (created.status === 'submitted') {
        setAttempt(created);
        return;
      }
      const next = createAssessmentDraft(created, questions);
      await persist(next, false).catch(() => undefined);
      if (mounted.current) setQuestionIndex(0);
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : 'Unable to start the test.');
    } finally {
      if (mounted.current) setStarting(false);
    }
  };
  if (!attempt || !draft)
    return (
      <AssessmentIntroduction
        title={title}
        kind={kind}
        questionCount={questions.length}
        lessonStartedAt={lessonStartedAt}
        placeholders={placeholders}
        error={error}
        starting={starting}
        begin={begin}
        exitPath={scope ? `/lessons/${scope.lessonId}` : '/'}
      />
    );

  const question = questions[questionIndex];
  const finalizing = submitting;
  const selected = attempt.answers.find(
    (answer) => answer.questionId === question?.id,
  )?.selectedChoiceId;
  const choose = (choiceId: string) => {
    const current = draftRef.current;
    if (
      !current ||
      !question ||
      submissionInFlightRef.current ||
      current.syncStatus === 'pending_submission'
    )
      return;
    setError('');
    void persist(updateDraftAnswer(current, question.id, choiceId), true).catch(() => undefined);
  };
  const handleChoiceKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    choiceIndex: number,
  ) => {
    playNeutralClickOnKeyDown(event);
    if (!question || !['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (choiceIndex + direction + question.choices.length) % question.choices.length;
    const nextButton = event.currentTarget.parentElement?.children[nextIndex];
    if (nextButton instanceof HTMLButtonElement) nextButton.focus();
    choose(question.choices[nextIndex].id);
  };
  const move = async (index: number) => {
    const current = draftRef.current;
    if (!current || submissionInFlightRef.current) return;
    const next = Math.max(0, Math.min(questions.length - 1, index));
    try {
      await persist(updateDraftPosition(current, next), false);
      if (mounted.current) setQuestionIndex(next);
    } catch {
      if (mounted.current) setError('Could not save your place on this device. Please try again.');
    }
  };
  const submit = async () => {
    const current = draftRef.current;
    if (!current || submissionInFlightRef.current) return;
    if (!selected) {
      setError('Choose an answer before submitting.');
      return;
    }
    setSubmitting(true);
    submissionInFlightRef.current = true;
    setError('');
    const pending = markDraftPendingSubmission(current);
    try {
      if (localLessonAssessment) {
        await localSaveQueueRef.current;
        if (kind === 'post-test' && navigator.onLine && scope) {
          // Supabase accepts the Post-test only after queued lesson progress
          // advances the attempt to the Post-test stage.
          await flushPendingLessonAttempt(userId, scope.lessonId, scope.lessonAttemptId);
        }
        const saved = await submitLocalLessonAssessment(pending);
        if (!mounted.current) return;
        applyDraft(saved);
        setDurability('saved');
        if (!navigator.onLine) {
          setSyncNotice('offline');
          return;
        }

        // A live connection can confirm this frozen local submission now.
        // Keep the local-first write for durability, but do not expose the
        // offline pending screen while the authoritative result is available.
        setSyncNotice('syncing');
        await flushPendingAssessmentDraft(saved);
        if (!mounted.current) return;
        if (kind === 'post-test') {
          const completed = await getAssessmentAttempt(userId, kind, scope);
          if (!completed || completed.status !== 'submitted')
            throw new Error('Unable to confirm this result. Please retry.');
          applyDraft(null);
          setAttempt(completed);
          setSyncNotice('none');
          return;
        }
        const completed = await getAssessmentAttempt(userId, kind, scope);
        if (!completed || completed.status !== 'submitted')
          throw new Error('Unable to confirm this result. Please retry.');
        applyDraft(null);
        setAttempt(completed);
        setSyncNotice('none');
        return;
      }
      await persist(pending, false);
      if (!navigator.onLine) {
        setSyncNotice('offline');
        setError('Submission is pending. Reconnect to confirm your official result.');
        return;
      }
      if (!synchronizerRef.current)
        throw new Error('Submission sync is not ready. Please try again.');
      await synchronizerRef.current.flush();
    } catch (cause) {
      setSyncNotice(navigator.onLine ? 'pending' : 'offline');
      setError(
        cause instanceof Error ? cause.message : 'Submission is not yet confirmed. Please retry.',
      );
    } finally {
      submissionInFlightRef.current = false;
      setSubmitting(false);
    }
  };
  const finalQuestion = questionIndex === questions.length - 1;
  const resolveConflict = async () => {
    if (
      !window.confirm(
        'Replace the answers in this window and on this device with the saved account answers? Unsynced local answers will be discarded.',
      )
    )
      return;
    try {
      await localSaveQueueRef.current.catch(() => undefined);
      const local = await getAssessmentDraft(userId, kind, db, scope?.lessonAttemptId);
      const server = await getAssessmentAttempt(userId, kind, scope);
      if (!mounted.current) return;
      if (!server || server.id !== draft.attemptId)
        throw new Error('Unable to confirm the saved test.');
      if (server.status === 'submitted') {
        synchronizerRef.current?.requestSync();
        return;
      }
      const replacement = createAssessmentDraft(server, questions, questionIndex);
      await replaceAssessmentDraft(local, replacement);
      if (!mounted.current) return;
      applyDraft(replacement);
      setDurability('saved');
      setSyncNotice('none');
      setError('');
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : 'Unable to reload the saved answers.');
    }
  };
  const syncMessage =
    durability === 'failed'
      ? 'Local saving failed. Your answers remain in this window; keep it open until account sync is confirmed.'
      : syncNotice === 'conflict'
        ? 'This test changed in another tab or device. Your local answers are preserved. Resolve the conflict before submitting.'
        : !connectionOnline &&
            (syncNotice === 'offline' || syncNotice === 'pending' || draft.syncStatus !== 'synced')
          ? 'Saved on this device.'
          : '';
  return (
    <section className="assessment-player lesson-timer-host page-enter" aria-labelledby="assessment-question">
      <LessonElapsedTimer startedAt={lessonStartedAt} />
      <header className="assessment-player__header">
        <Link to={scope ? `/lessons/${scope.lessonId}` : '/'}>← Save and exit</Link>
        <div>
          <span>{title}</span>
          <strong>
            Question {questionIndex + 1} of {questions.length}
          </strong>
        </div>
      </header>
      <div
        className="assessment-progress"
        aria-label={`${questionIndex + 1} of ${questions.length}`}
      >
        <span style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} />
      </div>
      <div className="assessment-question panel">
        {question.isPlaceholder && (
          <span className="placeholder-badge">Development placeholder</span>
        )}
        <h1 id="assessment-question" aria-live="polite" aria-atomic="true">
          {question.prompt}
        </h1>
        <CharacterAssistant
          state="explaining"
          dialogue={resolveCharacterDialogue('assessment-question')}
          presentation="inline"
          reactionKey={`${kind}-question-guidance`}
          announcement="off"
          className="assessment-question__companion"
        />
        <div className="assessment-choices" role="radiogroup" aria-labelledby="assessment-question">
          {question.choices.map((choice, choiceIndex) => (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={selected === choice.id}
              tabIndex={selected ? (selected === choice.id ? 0 : -1) : choiceIndex === 0 ? 0 : -1}
              className={selected === choice.id ? 'is-selected' : ''}
              disabled={finalizing || syncNotice === 'conflict'}
              onPointerDown={playNeutralClickOnPointerDown}
              onKeyDown={(event) => handleChoiceKeyDown(event, choiceIndex)}
              onClick={() => choose(choice.id)}
            >
              <span className="assessment-choice__marker" aria-hidden="true">
                {String.fromCharCode(65 + choiceIndex)}
              </span>
              <span className="assessment-choice__label">{choice.label}</span>
            </button>
          ))}
        </div>
        {syncMessage && (
          <p className="assessment-sync-note" role="status">
            {syncMessage}
          </p>
        )}
        {durability === 'failed' && syncNotice === 'none' && draft.syncStatus === 'synced' && (
          <p role="status">Account sync is confirmed; local recovery is unavailable.</p>
        )}
        {syncNotice === 'conflict' && (
          <Button variant="quiet" onClick={() => void resolveConflict()}>
            Load account answers
          </Button>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="assessment-question__footer">
          <Button
            variant="quiet"
            onPointerDown={playNeutralClickOnPointerDown}
            onKeyDown={playNeutralClickOnKeyDown}
            onClick={() => void move(questionIndex - 1)}
            disabled={questionIndex === 0 || submitting}
          >
            Previous
          </Button>
          <span aria-live="polite">{submitting ? 'Submitting test…' : ''}</span>
          <Button
            onPointerDown={playNeutralClickOnPointerDown}
            onKeyDown={playNeutralClickOnKeyDown}
            onClick={() => (finalQuestion ? void submit() : void move(questionIndex + 1))}
            disabled={submitting || syncNotice === 'conflict' || (!selected && !finalQuestion)}
            aria-busy={submitting}
          >
            {submitting ? 'Submitting…' : finalQuestion ? 'Submit test' : 'Next question'}
          </Button>
        </div>
      </div>
    </section>
  );
}

function AssessmentIntroduction({
  title,
  kind,
  questionCount,
  lessonStartedAt,
  placeholders,
  error,
  starting,
  begin,
  exitPath,
}: {
  title: string;
  kind: 'pre-test' | 'post-test';
  questionCount: number;
  lessonStartedAt: number | null;
  placeholders: boolean;
  error: string;
  starting: boolean;
  begin: () => Promise<void>;
  exitPath: string;
}) {
  return (
    <section className="assessment-shell panel lesson-timer-host page-enter">
      <p className="assessment-kicker">{title}</p>
      <LessonElapsedTimer startedAt={lessonStartedAt} />
      <h1>{kind === 'pre-test' ? 'Check what you know' : 'Show what you learned'}</h1>
      <p>
        This test has {questionCount} questions. Progress is saved on this device and synced
        securely when online. The test can only be submitted once.
      </p>
      <CharacterAssistant
        state="neutral"
        dialogue={resolveCharacterDialogue('assessment-introduction')}
        presentation="inline"
        reactionKey={`${kind}-introduction`}
        announcement="off"
        className="assessment-companion"
      />
      {placeholders && (
        <p className="assessment-placeholder-notice" role="note">
          Development preview: these sample questions will be replaced before research testing.
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="assessment-actions">
        <Link className="button button--quiet" to={exitPath}>
          Not now
        </Link>
        <Button
          onPointerDown={playNeutralClickOnPointerDown}
          onKeyDown={playNeutralClickOnKeyDown}
          onClick={() => void begin()}
          disabled={starting || questionCount === 0}
        >
          {starting ? 'Starting…' : `Start ${title.toLowerCase()}`}
        </Button>
      </div>
    </section>
  );
}

function AssessmentResult({
  title,
  kind,
  attempt,
  lessonStartedAt,
  continueLesson,
}: {
  title: string;
  kind: 'pre-test' | 'post-test';
  attempt: AssessmentAttempt;
  lessonStartedAt: number | null;
  continueLesson?: () => Promise<void>;
}) {
  const completionPlayedRef = useRef<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [continueError, setContinueError] = useState('');

  // This component is mounted only by the final result-render branch. Keeping
  // the trigger here means loading/error/retry branches cannot play it. The
  // audio manager owns the cross-mount one-shot guard and can hold this event
  // until saved audio settings finish hydrating.
  useEffect(() => {
    let pending = false;
    if (
      attempt.status === 'submitted' &&
      attempt.score !== null &&
      completionPlayedRef.current !== attempt.id
    ) {
      const status = attempt.score === 100 ? playReward(attempt.id) : playCompletion(attempt.id);
      pending = status === 'pending';
      if (!pending) completionPlayedRef.current = attempt.id;
    }
    return () => {
      if (pending) cancelPendingResultSfx(attempt.id);
    };
  }, [attempt.id, attempt.score, attempt.status]);

  return (
    <section className="assessment-shell assessment-state assessment-result panel lesson-timer-host page-enter">
      <p className="assessment-kicker">{title} complete</p>
      <LessonElapsedTimer startedAt={lessonStartedAt} stoppedAt={attempt.submittedAt} />
      <h1>{attempt.score}%</h1>
      <p>Your official score has been saved to your account.</p>
      <CharacterAssistant
        state="neutral"
        dialogue={resolveCharacterDialogue('assessment-completion')}
        presentation="inline"
        reactionKey={`${kind}-complete`}
        className="assessment-companion"
      />
      <dl className="assessment-result__details">
        <div>
          <dt>Questions</dt>
          <dd>{attempt.expectedQuestionCount}</dd>
        </div>
        <div>
          <dt>Time spent answering</dt>
          <dd>{attempt.answeringSeconds === null || attempt.answeringSeconds === undefined
            ? 'Not recorded'
            : duration(attempt.answeringSeconds)}</dd>
        </div>
      </dl>
      <div className="result-actions assessment-result__actions">
        <p className="assessment-note">
          Correct answers are hidden while the research is in progress.
        </p>
        {continueLesson ? (
          <Button
            className="assessment-result__return"
            onPointerDown={playNeutralClickOnPointerDown}
            onKeyDown={playNeutralClickOnKeyDown}
            disabled={continuing}
            onClick={() => {
              setContinuing(true);
              setContinueError('');
              void continueLesson().catch((cause: unknown) => {
                setContinuing(false);
                setContinueError(
                  cause instanceof Error ? cause.message : 'Unable to continue the lesson.',
                );
              });
            }}
          >
            {continuing
              ? 'Continuing…'
              : kind === 'pre-test'
                ? 'Continue to first chapter'
                : 'Finish lesson'}
          </Button>
        ) : (
          <Link
            className="button button--primary assessment-result__return"
            to="/"
            onPointerDown={playNeutralClickOnPointerDown}
            onKeyDown={playNeutralClickOnKeyDown}
          >
            Return home
          </Link>
        )}
        {continueError && <p className="form-error">{continueError}</p>}
      </div>
    </section>
  );
}
