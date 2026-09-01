import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import type { LearningLesson } from './domain/content.schemas';
import type { LessonAttempt } from '@/types/learning';
import { getLesson } from './content/content.service';
import {
  completeAttempt,
  getAttempt,
  recordAttemptActiveSeconds,
  submitActivityAnswer,
} from './attempts/attempt.service';
import { FindWordActivityView } from './activities/FindWordActivityView';
import { OrganizeTranslateActivityView } from './activities/OrganizeTranslateActivityView';
import type { ActivityAnswer } from './domain/evaluation';
import { ContentState } from './components/ContentState';

export function ActiveLessonPage() {
  const { lessonId = '', attemptId = '' } = useParams();
  const user = useAuthStore((state) => state.user);
  const contentStatus = useContentStore((state) => state.status);
  const navigate = useNavigate();
  const [lesson, setLesson] = useState<LearningLesson | null>(null);
  const [attempt, setAttempt] = useState<LessonAttempt | null>(null);
  const [activityIndex, setActivityIndex] = useState(0);
  const [confirmExit, setConfirmExit] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const activeSegmentStartedAt = useRef<number | null>(null);

  const flushActiveTime = useCallback(async () => {
    if (!attempt || activeSegmentStartedAt.current === null) return;
    const now = Date.now();
    const seconds = Math.floor((now - activeSegmentStartedAt.current) / 1000);
    if (seconds <= 0) return;
    activeSegmentStartedAt.current += seconds * 1000;
    await recordAttemptActiveSeconds(db, attempt.id, seconds);
  }, [attempt]);

  useEffect(() => {
    if (!user || contentStatus !== 'ready') return;
    void Promise.all([getLesson(db, lessonId), getAttempt(db, user.id, attemptId)]).then(
      async ([loadedLesson, loadedAttempt]) => {
        if (loadedAttempt.lessonId !== loadedLesson.id) throw new Error('Attempt mismatch.');
        if (loadedAttempt.status === 'completed') {
          navigate(`/lessons/${lessonId}/result/${attemptId}`, { replace: true });
          return;
        }
        if (loadedAttempt.answers.length >= loadedLesson.activities.length) {
          await completeAttempt(db, loadedAttempt.id);
          navigate(`/lessons/${lessonId}/result/${attemptId}`, { replace: true });
          return;
        }
        setLesson(loadedLesson);
        setAttempt(loadedAttempt);
        setActivityIndex(loadedAttempt.answers.length);
      },
    );
  }, [attemptId, contentStatus, lessonId, navigate, user]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const timeout = window.setTimeout(() => setSaveState('idle'), 2200);
    return () => window.clearTimeout(timeout);
  }, [saveState]);

  useEffect(() => {
    if (!attempt || attempt.status !== 'active') return;
    activeSegmentStartedAt.current = document.visibilityState === 'visible' ? Date.now() : null;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void flushActiveTime().catch(() => undefined);
        activeSegmentStartedAt.current = null;
      } else {
        activeSegmentStartedAt.current = Date.now();
      }
    };
    const interval = window.setInterval(
      () => void flushActiveTime().catch(() => undefined),
      30_000,
    );
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(interval);
      void flushActiveTime().catch(() => undefined);
      activeSegmentStartedAt.current = null;
    };
  }, [attempt, flushActiveTime]);

  if (!user || !lesson || !attempt) {
    return (
      <ContentState>
        <LoadingState
          className="lesson-player lesson-player--loading"
          message="Restoring your attempt…"
        />
      </ContentState>
    );
  }

  const activity = lesson.activities[activityIndex];
  const submitted = attempt.answers.find((answer) => answer.activityId === activity.id);
  const progressPercent = Math.round(
    ((activityIndex + (submitted ? 1 : 0)) / lesson.activities.length) * 100,
  );

  const submit = async (answer: ActivityAnswer) => {
    setSaveState('saving');
    try {
      const updated = await submitActivityAnswer(db, attempt.id, activity.id, answer);
      setAttempt(updated);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const continueLesson = async () => {
    if (!submitted) return;
    if (activityIndex === lesson.activities.length - 1) {
      await flushActiveTime().catch(() => undefined);
      await completeAttempt(db, attempt.id);
      navigate(`/lessons/${lesson.id}/result/${attempt.id}`);
      return;
    }
    setActivityIndex((index) => index + 1);
  };

  const exit = () => {
    if (attempt.answers.length > 0) setConfirmExit(true);
    else navigate(`/lessons/${lesson.id}`);
  };

  return (
    <ContentState>
      <div className="lesson-player page-enter">
        <header className="lesson-player__header">
          <button className="lesson-exit" onClick={exit}>
            ← Exit lesson
          </button>
          <div className="lesson-player__identity">
            <span>{lesson.title}</span>
            <strong>
              Activity {activityIndex + 1} of {lesson.activities.length}
            </strong>
          </div>
          <span
            className={`lesson-player__save-state lesson-player__save-state--${saveState}`}
            role="status"
            aria-live="polite"
          >
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && 'Answer saved'}
            {saveState === 'error' && 'Could not save. Try again.'}
          </span>
        </header>
        <div className="lesson-progress" aria-label={`${progressPercent}% complete`}>
          <span style={{ width: `${progressPercent}%` }} />
        </div>
        <main className="lesson-player__stage">
          {activity.type === 'find-word' ? (
            <FindWordActivityView
              key={activity.id}
              activity={activity}
              submitted={submitted}
              onSubmit={submit}
            />
          ) : (
            <OrganizeTranslateActivityView
              key={activity.id}
              activity={activity}
              submitted={submitted}
              onSubmit={submit}
            />
          )}
          {submitted && (
            <aside
              className={`answer-feedback answer-feedback--${submitted.isCorrect ? 'correct' : 'incorrect'}`}
              role="status"
            >
              <div className="answer-feedback__symbol" aria-hidden="true">
                {submitted.isCorrect ? '✓' : '!'}
              </div>
              <div>
                <p className="answer-feedback__status">
                  {submitted.isCorrect ? 'Correct' : 'Not quite'}
                </p>
                <h2>{activity.explanation.title}</h2>
                <p>{activity.explanation.body}</p>
              </div>
              <Button onClick={() => void continueLesson()}>
                {activityIndex === lesson.activities.length - 1 ? 'See results' : 'Continue'}
              </Button>
            </aside>
          )}
        </main>
        <ConfirmDialog
          open={confirmExit}
          title="Exit and resume later?"
          confirmLabel="Exit lesson"
          onCancel={() => setConfirmExit(false)}
          onConfirm={() => {
            void flushActiveTime().catch(() => undefined);
            navigate(`/lessons/${lesson.id}`);
          }}
        >
          Your submitted answers are saved to your account. The lesson overview will offer Resume or
          Restart when you return.
        </ConfirmDialog>
      </div>
    </ContentState>
  );
}
