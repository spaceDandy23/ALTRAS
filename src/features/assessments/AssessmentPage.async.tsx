import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingState';
import { CharacterAssistant } from '@/features/characters/components/CharacterAssistant';
import { resolveCharacterDialogue } from '@/features/characters/character.dialogue';
import { playCompletion } from '@/services/audio/audio.manager';
import {
  playNeutralClickOnKeyDown,
  playNeutralClickOnPointerDown,
} from '@/services/audio/click.handlers';
import { useAuthStore } from '@/stores/auth.store';
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
  createAssessmentDraft,
  deleteAssessmentDraft,
  draftToAttempt,
  getAssessmentDraft,
  markDraftPendingSubmission,
  reconcileAssessmentDraft,
  replaceAssessmentDraft,
  saveAssessmentDraft,
  updateDraftAnswer,
  updateDraftPosition,
  validateLocalDraft,
} from './assessment-draft.service';
import {
  completeAssessment,
  getAssessmentAttempt,
  getAssessmentQuestions,
  startAssessment,
  syncAssessmentDraft,
} from './assessment.service';

const duration = (seconds: number) =>
  seconds < 60 ? `${seconds} sec` : `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
type SyncNotice = 'none' | 'offline' | 'pending' | 'syncing' | 'conflict';

export function AssessmentPage() {
  const parsedKind = assessmentKindSchema.safeParse(useParams().kind ?? '');
  const kind = parsedKind.success ? parsedKind.data : null;
  const user = useAuthStore((state) => state.user);
  if (!kind)
    return (
      <section className="assessment-shell panel">
        <h1>Assessment not found</h1>
        <Link to="/">Return home</Link>
      </section>
    );
  if (!user) return <LoadingState variant="page" />;
  return <AssessmentSession key={`${user.id}:${kind}`} userId={user.id} kind={kind} />;
}

function AssessmentSession({ userId, kind }: { userId: string; kind: AssessmentKind }) {
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null);
  const [draft, setDraft] = useState<AssessmentDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncNotice, setSyncNotice] = useState<SyncNotice>('none');
  const [error, setError] = useState('');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [bootstrapError, setBootstrapError] = useState('');
  const [reload, setReload] = useState(0);
  const [durability, setDurability] = useState<'saving' | 'saved' | 'failed'>('saved');
  const [completionWarning, setCompletionWarning] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const draftRef = useRef<AssessmentDraft | null>(null);
  const synchronizerRef = useRef<AssessmentDraftSynchronizer | null>(null);
  const localSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const applyDraft = useCallback((next: AssessmentDraft | null) => {
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
    void Promise.allSettled([
      getAssessmentQuestions(kind),
      getAssessmentAttempt(userId, kind),
      getAssessmentDraft(userId, kind),
    ])
      .then(async ([questionsResult, attemptResult, localResult]) => {
        if (!active) return;
        if (localResult.status === 'rejected')
          throw new Error('Unable to read the local test draft. Please retry.');
        const local = localResult.value;
        const loadedQuestions =
          questionsResult.status === 'fulfilled' ? questionsResult.value : (local?.questions ?? []);
        const server = attemptResult.status === 'fulfilled' ? attemptResult.value : null;
        if (server && (server.userId !== userId || server.assessment !== kind))
          throw new Error('The test belongs to another session.');
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
          if (
            questionsResult.status === 'rejected' ||
            attemptResult.status === 'rejected' ||
            loadedQuestions.length === 0
          )
            throw new Error('Unable to load the test. Connect to the internet and try again.');
          for (const question of loadedQuestions) {
            assessmentQuestionSchema.parse(question);
            if (question.assessment !== kind)
              throw new Error('The test questions do not match this assessment.');
          }
          setQuestions(loadedQuestions);
          setAttempt(null);
        }
      })
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
  }, [applyDraft, persist, kind, userId, reload]);

  const draftId = draft?.id;
  useEffect(() => {
    if (!draftId || loading || bootstrapError) return;
    let active = true;
    const synchronizer = new AssessmentDraftSynchronizer({
      load: async () => {
        await localSaveQueueRef.current.catch(() => undefined);
        const current = draftRef.current;
        return current?.id === draftId ? current : null;
      },
      read: () => getAssessmentAttempt(userId, kind),
      sync: syncAssessmentDraft,
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
      complete: (current) => completeAssessment(userId, kind, current.attemptId, current.revision),
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
        if (!active) return;
        if (
          completed.id !== snapshot.attemptId ||
          completed.userId !== userId ||
          completed.assessment !== kind ||
          completed.status !== 'submitted'
        )
          throw new Error('Unable to confirm this result.');
        await localSaveQueueRef.current.catch(() => undefined);
        if (!active) return;
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
        if (!active) return;
        if (!cleared)
          setCompletionWarning(
            'Your official result is saved. An unconfirmed local draft has been kept on this device.',
          );
        applyDraft(null);
        setAttempt(completed);
        setSubmitting(false);
        setSyncNotice('none');
        playCompletion(completed.id, false);
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
  }, [applyDraft, persist, draftId, kind, userId, loading, bootstrapError]);

  const title = kind === 'pre-test' ? 'Pre-test' : 'Post-test';
  const placeholders = useMemo(
    () => questions.some((question) => question.isPlaceholder),
    [questions],
  );
  if (loading)
    return <LoadingState variant="page" message={`Preparing the ${title.toLowerCase()}…`} />;
  if (bootstrapError)
    return (
      <section className="assessment-shell panel">
        <p className="assessment-kicker">{title}</p>
        <h1>We couldn’t load this test</h1>
        <p role="alert">{bootstrapError}</p>
        <Button
          onClick={() => {
            setLoading(true);
            setBootstrapError('');
            setReload((value) => value + 1);
          }}
        >
          Try again
        </Button>
        <Link className="button button--secondary" to="/">
          Return home
        </Link>
      </section>
    );
  if (attempt?.status === 'submitted')
    return (
      <>
        <AssessmentResult title={title} kind={kind} attempt={attempt} />
        {completionWarning && <p role="status">{completionWarning}</p>}
      </>
    );

  const begin = async () => {
    if (starting) return;
    setStarting(true);
    setError('');
    try {
      const created = await startAssessment(userId, kind);
      if (!mounted.current) return;
      if (created.userId !== userId || created.assessment !== kind)
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
        placeholders={placeholders}
        error={error}
        starting={starting}
        begin={begin}
      />
    );

  const question = questions[questionIndex];
  const finalizing = submitting || draft.syncStatus === 'pending_submission';
  const selected = attempt.answers.find(
    (answer) => answer.questionId === question?.id,
  )?.selectedChoiceId;
  const choose = (choiceId: string) => {
    const current = draftRef.current;
    if (!current || !question || current.syncStatus === 'pending_submission') return;
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
  const move = (index: number) => {
    const current = draftRef.current;
    if (!current || current.syncStatus === 'pending_submission') return;
    const next = Math.max(0, Math.min(questions.length - 1, index));
    setQuestionIndex(next);
    void persist(updateDraftPosition(current, next), false).catch(() => undefined);
  };
  const submit = async () => {
    const current = draftRef.current;
    if (!current || submitting || !selected) return;
    setSubmitting(true);
    setError('');
    const pending = markDraftPendingSubmission(current);
    try {
      await persist(pending, false).catch(() => undefined);
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
      const local = await getAssessmentDraft(userId, kind);
      const server = await getAssessmentAttempt(userId, kind);
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
      : durability === 'saving'
        ? 'Saving on this device…'
        : syncNotice === 'conflict'
          ? 'This test changed in another tab or device. Your local answers are preserved. Resolve the conflict before submitting.'
          : syncNotice === 'syncing'
            ? 'Saved on this device. Syncing to your account…'
            : syncNotice === 'offline' || syncNotice === 'pending' || draft.syncStatus !== 'synced'
              ? 'Saved on this device. Account sync is pending.'
              : 'Synced to your account.';
  return (
    <section className="assessment-player page-enter" aria-labelledby="assessment-question">
      <header className="assessment-player__header">
        <Link to="/">← Save and exit</Link>
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
              <span aria-hidden="true">{choice.id.toUpperCase()}</span>
              {choice.label}
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
        {(syncNotice === 'pending' || syncNotice === 'offline') && (
          <Button variant="quiet" onClick={() => synchronizerRef.current?.requestSync()}>
            Retry sync
          </Button>
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
            onClick={() => move(questionIndex - 1)}
            disabled={questionIndex === 0 || finalizing}
          >
            Previous
          </Button>
          <span aria-live="polite">{submitting ? 'Submitting test…' : ''}</span>
          <Button
            onPointerDown={playNeutralClickOnPointerDown}
            onKeyDown={playNeutralClickOnKeyDown}
            onClick={() => (finalQuestion ? void submit() : move(questionIndex + 1))}
            disabled={!selected || submitting || syncNotice === 'conflict'}
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
  placeholders,
  error,
  starting,
  begin,
}: {
  title: string;
  kind: 'pre-test' | 'post-test';
  questionCount: number;
  placeholders: boolean;
  error: string;
  starting: boolean;
  begin: () => Promise<void>;
}) {
  return (
    <section className="assessment-shell panel page-enter">
      <p className="assessment-kicker">{title}</p>
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
        <Link className="button button--quiet" to="/">
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
}: {
  title: string;
  kind: 'pre-test' | 'post-test';
  attempt: AssessmentAttempt;
}) {
  return (
    <section className="assessment-shell assessment-result panel page-enter">
      <p className="assessment-kicker">{title} complete</p>
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
          <dt>Completion time</dt>
          <dd>{duration(attempt.completionSeconds ?? 0)}</dd>
        </div>
      </dl>
      <div className="result-actions assessment-result__actions">
        <p className="assessment-note">
          Correct answers are hidden while the research is in progress.
        </p>
        <Link
          className="button button--primary assessment-result__return"
          to="/"
          onPointerDown={playNeutralClickOnPointerDown}
          onKeyDown={playNeutralClickOnKeyDown}
        >
          Return home
        </Link>
      </div>
    </section>
  );
}
