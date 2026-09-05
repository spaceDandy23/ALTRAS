import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingState';
import { CharacterAssistant } from '@/features/characters/components/CharacterAssistant';
import { resolveCharacterDialogue } from '@/features/characters/character.dialogue';
import { playCompletion } from '@/services/audio/audio.manager';
import { playNeutralClickOnKeyDown, playNeutralClickOnPointerDown } from '@/services/audio/click.handlers';
import { useAuthStore } from '@/stores/auth.store';
import { assessmentKindSchema, type AssessmentAttempt, type AssessmentDraft, type AssessmentQuestion } from '@/types/assessment';
import { AssessmentDraftSynchronizer, createAssessmentDraft, deleteAssessmentDraft, draftToAttempt, getAssessmentDraft, markAssessmentDraftSynced, markDraftPendingSubmission, reconcileAssessmentDraft, saveAssessmentDraft, updateDraftAnswer, updateDraftPosition } from './assessment-draft.service';
import { completeAssessment, getAssessmentAttempt, getAssessmentQuestions, startAssessment, submitAssessmentAnswer } from './assessment.service';

const duration = (seconds: number) => seconds < 60 ? `${seconds} sec` : `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
type SyncNotice = 'none' | 'offline' | 'pending';

export function AssessmentPage() {
  const parsedKind = assessmentKindSchema.safeParse(useParams().kind ?? '');
  const kind = parsedKind.success ? parsedKind.data : null;
  const user = useAuthStore((state) => state.user);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null);
  const [draft, setDraft] = useState<AssessmentDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncNotice, setSyncNotice] = useState<SyncNotice>('none');
  const [error, setError] = useState('');
  const [questionIndex, setQuestionIndex] = useState(0);
  const draftRef = useRef<AssessmentDraft | null>(null);
  const synchronizerRef = useRef<AssessmentDraftSynchronizer | null>(null);
  const localSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const applyDraft = useCallback((next: AssessmentDraft | null) => {
    draftRef.current = next;
    setDraft(next);
    if (next) setAttempt(draftToAttempt(next));
  }, []);
  const persist = (next: AssessmentDraft, shouldSync: boolean) => {
    applyDraft(next);
    localSaveQueueRef.current = localSaveQueueRef.current.catch(() => undefined)
      .then(() => saveAssessmentDraft(next))
      .then(() => { if (shouldSync) synchronizerRef.current?.requestSync(); })
      .catch(() => setSyncNotice('pending'));
    return localSaveQueueRef.current;
  };

  useEffect(() => {
    if (!user || !kind) return;
    let active = true;
    localSaveQueueRef.current = Promise.resolve();
    void Promise.allSettled([getAssessmentQuestions(kind), getAssessmentAttempt(user.id, kind), getAssessmentDraft(user.id, kind)])
      .then(async ([questionsResult, attemptResult, localResult]) => {
        if (!active) return;
        const local = localResult.status === 'fulfilled' ? localResult.value : null;
        const loadedQuestions = questionsResult.status === 'fulfilled' ? questionsResult.value : (local?.questions ?? []);
        const server = attemptResult.status === 'fulfilled' ? attemptResult.value : null;
        if (server?.status === 'submitted') {
          if (local?.attemptId === server.id) await deleteAssessmentDraft(local.id);
          if (!active) return;
          setQuestions(loadedQuestions);
          setAttempt(server);
          applyDraft(null);
        } else if (server) {
          const reconciled = reconcileAssessmentDraft(server, local, loadedQuestions);
          await saveAssessmentDraft(reconciled);
          if (!active) return;
          setQuestions(reconciled.questions);
          applyDraft(reconciled);
          setQuestionIndex(Math.min(reconciled.currentQuestionIndex, Math.max(reconciled.questions.length - 1, 0)));
        } else if (local) {
          setQuestions(local.questions);
          applyDraft(local);
          setQuestionIndex(Math.min(local.currentQuestionIndex, Math.max(local.questions.length - 1, 0)));
          setSyncNotice(navigator.onLine ? 'pending' : 'offline');
        } else {
          if (questionsResult.status === 'rejected' || attemptResult.status === 'rejected') setError('Unable to load the test. Connect to the internet and try again.');
          setQuestions(loadedQuestions);
          setAttempt(null);
        }
        setLoading(false);
      });
    return () => { active = false; };
  }, [applyDraft, kind, user]);

  const draftId = draft?.id;
  useEffect(() => {
    if (!user || !kind || !draftId) return;
    let active = true;
    const synchronizer = new AssessmentDraftSynchronizer({
      load: async () => {
        const current = await getAssessmentDraft(user.id, kind);
        return current?.id === draftId ? current : null;
      },
      sync: async (current) => {
        const snapshot = draftToAttempt(current);
        for (const answer of current.answers) await submitAssessmentAnswer(current.attemptId, answer.questionId, answer.selectedChoiceId, snapshot);
        if (current.syncStatus === 'pending_submission') {
          const completed = await completeAssessment(user.id, kind, current.attemptId);
          await deleteAssessmentDraft(current.id);
          if (active) {
            draftRef.current = null;
            setDraft(null);
            setAttempt(completed);
            setSyncNotice('none');
            playCompletion(completed.id, false);
          }
        }
      },
      markSynced: async (id, revision) => {
        await markAssessmentDraftSynced(id, revision);
        const current = await getAssessmentDraft(user.id, kind);
        if (active && current?.id === id && current.revision === revision) { draftRef.current = current; setDraft(current); }
      },
      onStatus: (status) => {
        if (!active) return;
        if (status === 'synced') setSyncNotice('none');
        if (status === 'pending') setSyncNotice(navigator.onLine ? 'pending' : 'offline');
      },
    });
    synchronizerRef.current = synchronizer;
    if (draftRef.current?.syncStatus !== 'synced') synchronizer.requestSync();
    const retry = () => synchronizer.requestSync();
    const retryVisible = () => { if (document.visibilityState === 'visible') synchronizer.requestSync(); };
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
  }, [draftId, kind, user]);

  const title = kind === 'pre-test' ? 'Pre-test' : 'Post-test';
  const placeholders = useMemo(() => questions.some((question) => question.isPlaceholder), [questions]);
  if (!kind) return <section className="assessment-shell panel"><h1>Assessment not found</h1><Link to="/">Return home</Link></section>;
  if (loading) return <LoadingState variant="page" message={`Preparing the ${title.toLowerCase()}…`} />;
  if (error && questions.length === 0) return <section className="assessment-shell panel"><p className="assessment-kicker">{title}</p><h1>We couldn’t load this test</h1><p>{error}</p><Link className="button button--secondary" to="/">Return home</Link></section>;
  if (attempt?.status === 'submitted') return <AssessmentResult title={title} kind={kind} attempt={attempt} />;

  const begin = async () => {
    if (!user) return;
    setStarting(true); setError('');
    try {
      const next = createAssessmentDraft(await startAssessment(user.id, kind), questions);
      await saveAssessmentDraft(next);
      applyDraft(next); setQuestionIndex(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to start the test.'); }
    finally { setStarting(false); }
  };
  if (!attempt || !draft) return <AssessmentIntroduction title={title} kind={kind} questionCount={questions.length} placeholders={placeholders} error={error} starting={starting} begin={begin} />;

  const question = questions[questionIndex];
  const selected = attempt.answers.find((answer) => answer.questionId === question?.id)?.selectedChoiceId;
  const choose = (choiceId: string) => {
    const current = draftRef.current;
    if (!current || !question || submitting) return;
    setError('');
    void persist(updateDraftAnswer(current, question.id, choiceId), true);
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
    if (!current || submitting) return;
    const next = Math.max(0, Math.min(questions.length - 1, index));
    setQuestionIndex(next);
    void persist(updateDraftPosition(current, next), false);
  };
  const submit = async () => {
    const current = draftRef.current;
    if (!current || submitting || !selected) return;
    setSubmitting(true); setError('');
    const pending = markDraftPendingSubmission(current);
    try {
      await persist(pending, false);
      if (!navigator.onLine) {
        setSyncNotice('offline');
        setError('Your answers are saved on this device and will be submitted when you’re back online.');
        return;
      }
      if (!synchronizerRef.current) throw new Error('Submission sync is not ready. Please try again.');
      await synchronizerRef.current.flush();
    } catch (cause) {
      setSyncNotice(navigator.onLine ? 'pending' : 'offline');
      setError(cause instanceof Error ? cause.message : 'Your answers are saved on this device. We’ll retry syncing.');
    } finally { setSubmitting(false); }
  };
  const finalQuestion = questionIndex === questions.length - 1;
  const syncMessage = syncNotice === 'offline' ? 'Offline — progress saved on this device.' : syncNotice === 'pending' ? 'Progress is saved on this device. We’ll retry syncing.' : '';
  return (
    <section className="assessment-player page-enter" aria-labelledby="assessment-question">
      <header className="assessment-player__header"><Link to="/">← Save and exit</Link><div><span>{title}</span><strong>Question {questionIndex + 1} of {questions.length}</strong></div></header>
      <div className="assessment-progress" aria-label={`${questionIndex + 1} of ${questions.length}`}><span style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} /></div>
      <div className="assessment-question panel">
        {question.isPlaceholder && <span className="placeholder-badge">Development placeholder</span>}
        <h1 id="assessment-question" aria-live="polite" aria-atomic="true">{question.prompt}</h1>
        <CharacterAssistant state="explaining" dialogue={resolveCharacterDialogue('assessment-question')} presentation="inline" reactionKey={`${kind}-question-guidance`} announcement="off" className="assessment-question__companion" />
        <div className="assessment-choices" role="radiogroup" aria-labelledby="assessment-question">
          {question.choices.map((choice, choiceIndex) => (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={selected === choice.id}
              tabIndex={selected ? (selected === choice.id ? 0 : -1) : choiceIndex === 0 ? 0 : -1}
              className={selected === choice.id ? 'is-selected' : ''}
              disabled={submitting}
              onPointerDown={playNeutralClickOnPointerDown}
              onKeyDown={(event) => handleChoiceKeyDown(event, choiceIndex)}
              onClick={() => choose(choice.id)}
            >
              <span aria-hidden="true">{choice.id.toUpperCase()}</span>
              {choice.label}
            </button>
          ))}
        </div>
        {syncMessage && <p className="assessment-sync-note" role="status">{syncMessage}</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="assessment-question__footer">
          <Button variant="quiet" onPointerDown={playNeutralClickOnPointerDown} onKeyDown={playNeutralClickOnKeyDown} onClick={() => move(questionIndex - 1)} disabled={questionIndex === 0 || submitting}>Previous</Button>
          <span aria-live="polite">{submitting ? 'Submitting test…' : ''}</span>
          <Button onPointerDown={playNeutralClickOnPointerDown} onKeyDown={playNeutralClickOnKeyDown} onClick={() => finalQuestion ? void submit() : move(questionIndex + 1)} disabled={!selected || submitting} aria-busy={submitting}>{submitting ? 'Submitting…' : finalQuestion ? 'Submit test' : 'Next question'}</Button>
        </div>
      </div>
    </section>
  );
}

function AssessmentIntroduction({ title, kind, questionCount, placeholders, error, starting, begin }: { title: string; kind: 'pre-test' | 'post-test'; questionCount: number; placeholders: boolean; error: string; starting: boolean; begin: () => Promise<void> }) {
  return <section className="assessment-shell panel page-enter"><p className="assessment-kicker">{title}</p><h1>{kind === 'pre-test' ? 'Check what you know' : 'Show what you learned'}</h1><p>This test has {questionCount} questions. Progress is saved on this device and synced securely when online. The test can only be submitted once.</p><CharacterAssistant state="neutral" dialogue={resolveCharacterDialogue('assessment-introduction')} presentation="inline" reactionKey={`${kind}-introduction`} announcement="off" className="assessment-companion" />{placeholders && <p className="assessment-placeholder-notice" role="note">Development preview: these sample questions will be replaced before research testing.</p>}{error && <p className="form-error">{error}</p>}<div className="assessment-actions"><Link className="button button--quiet" to="/">Not now</Link><Button onPointerDown={playNeutralClickOnPointerDown} onKeyDown={playNeutralClickOnKeyDown} onClick={() => void begin()} disabled={starting || questionCount === 0}>{starting ? 'Starting…' : `Start ${title.toLowerCase()}`}</Button></div></section>;
}

function AssessmentResult({ title, kind, attempt }: { title: string; kind: 'pre-test' | 'post-test'; attempt: AssessmentAttempt }) {
  return <section className="assessment-shell assessment-result panel page-enter"><p className="assessment-kicker">{title} complete</p><h1>{attempt.score}%</h1><p>Your official score has been saved to your account.</p><CharacterAssistant state="neutral" dialogue={resolveCharacterDialogue('assessment-completion')} presentation="inline" reactionKey={`${kind}-complete`} className="assessment-companion" /><dl className="assessment-result__details"><div><dt>Questions</dt><dd>{attempt.expectedQuestionCount}</dd></div><div><dt>Completion time</dt><dd>{duration(attempt.completionSeconds ?? 0)}</dd></div></dl><div className="result-actions assessment-result__actions"><p className="assessment-note">Correct answers are hidden while the research is in progress.</p><Link className="button button--primary assessment-result__return" to="/" onPointerDown={playNeutralClickOnPointerDown} onKeyDown={playNeutralClickOnKeyDown}>Return home</Link></div></section>;
}
