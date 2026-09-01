import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingState';
import { useAuthStore } from '@/stores/auth.store';
import { assessmentKindSchema, type AssessmentAttempt } from '@/types/assessment';
import {
  completeAssessment,
  getAssessmentAttempt,
  getAssessmentQuestions,
  startAssessment,
  submitAssessmentAnswer,
} from './assessment.service';
import type { AssessmentQuestion } from '@/types/assessment';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes} min ${remainder} sec`;
}

export function AssessmentPage() {
  const { kind: rawKind = '' } = useParams();
  const kindResult = assessmentKindSchema.safeParse(rawKind);
  const kind = kindResult.success ? kindResult.data : null;
  const user = useAuthStore((state) => state.user);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [attempt, setAttempt] = useState<AssessmentAttempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [questionIndex, setQuestionIndex] = useState(0);

  useEffect(() => {
    if (!user || !kind) return;
    let active = true;
    void Promise.all([getAssessmentQuestions(kind), getAssessmentAttempt(user.id, kind)])
      .then(([loadedQuestions, loadedAttempt]) => {
        if (!active) return;
        setQuestions(loadedQuestions);
        setAttempt(loadedAttempt);
        setQuestionIndex(
          Math.min(loadedAttempt?.answers.length ?? 0, Math.max(loadedQuestions.length - 1, 0)),
        );
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load the test.');
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [kind, user]);

  const title = kind === 'pre-test' ? 'Pre-test' : 'Post-test';
  const hasPlaceholders = useMemo(
    () => questions.some((question) => question.isPlaceholder),
    [questions],
  );

  if (!kind) {
    return (
      <section className="assessment-shell panel">
        <h1>Assessment not found</h1>
        <Link to="/">Return home</Link>
      </section>
    );
  }

  if (loading) {
    return (
      <LoadingState
        className="assessment-loading"
        message={`Preparing the ${title.toLowerCase()}…`}
      />
    );
  }

  if (error && questions.length === 0) {
    return (
      <section className="assessment-shell panel">
        <p className="assessment-kicker">{title}</p>
        <h1>We couldn’t load this test</h1>
        <p>{error}</p>
        <Link className="button button--secondary" to="/">
          Return home
        </Link>
      </section>
    );
  }

  if (attempt?.status === 'submitted') {
    return (
      <section className="assessment-shell assessment-result panel page-enter">
        <p className="assessment-kicker">{title} complete</p>
        <h1>{attempt.score}%</h1>
        <p>Your official score has been saved to your account.</p>
        <dl className="assessment-result__details">
          <div>
            <dt>Questions</dt>
            <dd>{attempt.expectedQuestionCount}</dd>
          </div>
          <div>
            <dt>Completion time</dt>
            <dd>{formatDuration(attempt.completionSeconds ?? 0)}</dd>
          </div>
        </dl>
        <p className="assessment-note">
          Correct answers are hidden while the research is in progress.
        </p>
        <Link className="button button--primary" to="/">
          Return home
        </Link>
      </section>
    );
  }

  const begin = async () => {
    if (!user) return;
    setSaving(true);
    setError('');
    try {
      setAttempt(await startAssessment(user.id, kind));
      setQuestionIndex(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start the test.');
    } finally {
      setSaving(false);
    }
  };

  if (!attempt) {
    return (
      <section className="assessment-shell panel page-enter">
        <p className="assessment-kicker">{title}</p>
        <h1>{kind === 'pre-test' ? 'Check what you know' : 'Show what you learned'}</h1>
        <p>
          This test has {questions.length} questions. Your answers are saved online, and the test
          can only be submitted once.
        </p>
        {hasPlaceholders && (
          <p className="assessment-placeholder-notice" role="note">
            Development preview: these sample questions will be replaced before research testing.
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="assessment-actions">
          <Link className="button button--quiet" to="/">
            Not now
          </Link>
          <Button onClick={() => void begin()} disabled={saving || questions.length === 0}>
            {saving ? 'Starting…' : `Start ${title.toLowerCase()}`}
          </Button>
        </div>
      </section>
    );
  }

  const question = questions[questionIndex];
  const submitted = attempt.answers.find((answer) => answer.questionId === question?.id);

  const choose = async (choiceId: string) => {
    if (!user || !question || submitted) return;
    setSaving(true);
    setError('');
    try {
      setAttempt(await submitAssessmentAnswer(user.id, kind, attempt.id, question.id, choiceId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save this answer.');
    } finally {
      setSaving(false);
    }
  };

  const continueTest = async () => {
    if (!user || !submitted) return;
    if (questionIndex < questions.length - 1) {
      setQuestionIndex((index) => index + 1);
      return;
    }
    setSaving(true);
    setError('');
    try {
      setAttempt(await completeAssessment(user.id, kind, attempt.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit the test.');
    } finally {
      setSaving(false);
    }
  };

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
        <h1 id="assessment-question">{question.prompt}</h1>
        <div className="assessment-choices">
          {question.choices.map((choice) => (
            <button
              key={choice.id}
              className={submitted?.selectedChoiceId === choice.id ? 'is-selected' : ''}
              disabled={saving || Boolean(submitted)}
              onClick={() => void choose(choice.id)}
            >
              <span aria-hidden="true">{choice.id.toUpperCase()}</span>
              {choice.label}
            </button>
          ))}
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="assessment-question__footer">
          <span role="status">{saving ? 'Saving…' : submitted ? 'Answer saved' : ''}</span>
          <Button onClick={() => void continueTest()} disabled={!submitted || saving}>
            {questionIndex === questions.length - 1 ? 'Submit test' : 'Next question'}
          </Button>
        </div>
      </div>
    </section>
  );
}
