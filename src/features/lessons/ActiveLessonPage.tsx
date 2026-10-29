import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageLoadError } from '@/components/ui/PageLoadError';
import { ActivityCharacterAssistant } from '@/features/characters/components/ActivityCharacterAssistant';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import type { LearningLesson } from './domain/content.schemas';
import type { LessonAttempt } from '@/types/learning';
import { getLesson } from './content/content.service';
import {
  completeAttempt,
  consumeLessonAttemptLaunchMode,
  getAttempt,
  recordAttemptActiveSeconds,
  submitActivityAnswer,
} from './attempts/attempt.service';
import {
  LessonDraftSynchronizer,
  acknowledgeLessonActiveTime,
  acknowledgeLessonAnswer,
  deleteLessonDraft,
  getLessonDraft,
  markLessonDraftPendingCompletion,
  queueLessonAnswer,
  queueLessonActiveTime,
  reconcileLessonDraft,
  saveLessonDraft,
  updateLessonDraftPosition,
  type LessonDraft,
} from './attempts/lesson-draft.service';
import { FindWordActivityView } from './activities/FindWordActivityView';
import { OrganizeTranslateActivityView } from './activities/OrganizeTranslateActivityView';
import type { ActivityAnswer } from './domain/evaluation';
import { ContentState } from './components/ContentState';
import { playSfx } from '@/services/audio/audio.manager';
import {
  playNeutralClickOnKeyDown,
  playNeutralClickOnPointerDown,
} from '@/services/audio/click.handlers';

export function ActiveLessonPage() {
  const { lessonId = '', attemptId = '' } = useParams();
  const user = useAuthStore((state) => state.user);
  const contentStatus = useContentStore((state) => state.status);
  const navigate = useNavigate();
  const [lesson, setLesson] = useState<LearningLesson | null>(null);
  const [attempt, setAttempt] = useState<LessonAttempt | null>(null);
  const [draft, setDraft] = useState<LessonDraft | null>(null);
  const [activityIndex, setActivityIndex] = useState(0);
  const [confirmExit, setConfirmExit] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'pending' | 'error'>(
    'idle',
  );
  const [hintActivityId, setHintActivityId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loadRevision, setLoadRevision] = useState(0);
  const [loadedFor, setLoadedFor] = useState('');
  const loadKey = `${user?.id ?? 'guest'}:${lessonId}:${attemptId}:${loadRevision}`;
  const [launchMode] = useState(() => consumeLessonAttemptLaunchMode(attemptId));
  const activeSegmentStartedAt = useRef<number | null>(null);
  const activeTimeFlushRef = useRef<Promise<void>>(Promise.resolve());
  const synchronizerRef = useRef<LessonDraftSynchronizer | null>(null);
  const audibleAnswerIdRef = useRef<string | null>(null);
  const draftId = draft?.id;

  const applyDraft = useCallback((next: LessonDraft) => {
    setDraft(next);
    setLesson(next.lesson);
    setAttempt(next.attempt);
    setActivityIndex(next.currentActivityIndex);
  }, []);

  const flushActiveTime = useCallback(
    (until = Date.now(), pauseAfterFlush = false) => {
      const run = activeTimeFlushRef.current
        .catch(() => undefined)
        .then(async () => {
          const startedAt = activeSegmentStartedAt.current;
          if (!draftId || startedAt === null) return;
          const seconds = Math.floor((until - startedAt) / 1000);
          if (seconds <= 0) {
            if (pauseAfterFlush) activeSegmentStartedAt.current = null;
            return;
          }
          const next = await queueLessonActiveTime(draftId, seconds);
          if (!next) return;
          activeSegmentStartedAt.current = pauseAfterFlush ? null : startedAt + seconds * 1000;
          setDraft(next);
          if (navigator.onLine) synchronizerRef.current?.requestSync();
        });
      activeTimeFlushRef.current = run;
      return run;
    },
    [draftId],
  );

  useEffect(() => {
    if (!user || contentStatus !== 'ready') return;
    let current = true;
    void Promise.all([
      getLessonDraft(user.id, lessonId, attemptId),
      navigator.onLine
        ? Promise.all([
            getLesson(db, lessonId, attemptId),
            getAttempt(db, user.id, attemptId),
          ]).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(async ([local, remote]) => {
        if (!remote) {
          if (!local) throw new Error('No saved lesson attempt is available.');
          if (!current) return;
          applyDraft(local);
          setLoadError('');
          setLoadedFor(loadKey);
          setSaveState(local.syncStatus === 'synced' ? 'saved' : 'pending');
          return;
        }
        const [loadedLesson, loadedAttempt] = remote;
        if (loadedAttempt.lessonId !== loadedLesson.id) throw new Error('Attempt mismatch.');
        if (loadedAttempt.status === 'completed') {
          await deleteLessonDraft(local?.id ?? `${user.id}:${lessonId}:${attemptId}`);
          if (current) navigate(`/lessons/${lessonId}/result/${attemptId}`, { replace: true });
          return;
        }
        let next = reconcileLessonDraft(loadedAttempt, loadedLesson, local);
        if (loadedAttempt.answers.length >= loadedLesson.activities.length) {
          next = markLessonDraftPendingCompletion(next);
        }
        await saveLessonDraft(next);
        if (!current) return;
        applyDraft(next);
        setLoadError('');
        setLoadedFor(loadKey);
      })
      .catch(() => {
        if (current) {
          setLoadError('Your lesson attempt could not be restored.');
          setLoadedFor(loadKey);
        }
      });
    return () => {
      current = false;
    };
  }, [applyDraft, attemptId, contentStatus, lessonId, loadKey, navigate, user]);

  useEffect(() => {
    if (!user) return;
    const synchronizer = new LessonDraftSynchronizer({
      load: () => getLessonDraft(user.id, lessonId, attemptId),
      recordActiveTime: (_snapshot, segment) =>
        recordAttemptActiveSeconds(db, attemptId, segment.seconds, segment.id),
      acknowledgeActiveTime: async (snapshot, segment) => {
        const next = await acknowledgeLessonActiveTime(snapshot.id, segment.id);
        if (next) setDraft(next);
      },
      submit: (snapshot, answer) =>
        submitActivityAnswer(
          db,
          snapshot.attemptId,
          answer.activityId,
          answer.answer,
          snapshot.attempt,
        ),
      acknowledge: async (snapshot, answer, serverAttempt) => {
        let next = await acknowledgeLessonAnswer(snapshot.id, answer, serverAttempt);
        if (!next) return;
        const refreshedLesson = await getLesson(db, lessonId, attemptId).catch(() => next?.lesson);
        if (refreshedLesson) {
          next = {
            ...next,
            lesson: refreshedLesson,
            revision: next.revision + 1,
            updatedAt: Date.now(),
          };
          await saveLessonDraft(next);
        }
        const submittedAnswer = serverAttempt.answers.find(
          (item) => item.activityId === answer.activityId,
        );
        const shouldPlayAnswerSfx = audibleAnswerIdRef.current === answer.activityId;
        if (shouldPlayAnswerSfx) audibleAnswerIdRef.current = null;
        if (submittedAnswer && shouldPlayAnswerSfx) {
          playSfx(submittedAnswer.isCorrect ? 'correct' : 'incorrect');
        }
        applyDraft(next);
      },
      complete: (snapshot) => completeAttempt(db, snapshot.attemptId),
      onCompleted: async (snapshot) => {
        await deleteLessonDraft(snapshot.id);
        navigate(`/lessons/${snapshot.lessonId}/result/${snapshot.attemptId}`, { replace: true });
      },
      onStatus: (status) => {
        setSaveState(status === 'syncing' ? 'saving' : status === 'synced' ? 'saved' : 'pending');
      },
    });
    synchronizerRef.current = synchronizer;
    const requestSync = () => synchronizer.requestSync();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestSync();
    };
    window.addEventListener('online', requestSync);
    window.addEventListener('focus', requestSync);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('online', requestSync);
      window.removeEventListener('focus', requestSync);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      synchronizer.dispose();
      if (synchronizerRef.current === synchronizer) synchronizerRef.current = null;
    };
  }, [applyDraft, attemptId, lessonId, navigate, user]);

  useEffect(() => {
    if (draftId && navigator.onLine) synchronizerRef.current?.requestSync();
  }, [draftId]);

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
        void flushActiveTime(Date.now(), true).catch(() => setSaveState('error'));
      } else {
        void activeTimeFlushRef.current.finally(() => {
          if (document.visibilityState === 'visible' && activeSegmentStartedAt.current === null) {
            activeSegmentStartedAt.current = Date.now();
          }
        });
      }
    };
    const interval = window.setInterval(
      () => void flushActiveTime().catch(() => setSaveState('error')),
      30_000,
    );
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(interval);
      void flushActiveTime(Date.now(), true).catch(() => undefined);
    };
  }, [attempt, flushActiveTime]);

  if (loadedFor === loadKey && loadError) {
    return (
      <ContentState>
        <PageLoadError
          title="Lesson attempt unavailable"
          message={loadError}
          onRetry={() => setLoadRevision((revision) => revision + 1)}
        />
      </ContentState>
    );
  }

  if (loadedFor !== loadKey || !user || !lesson || !attempt || !draft) {
    const launchMessage =
      launchMode === 'first'
        ? 'Starting your lesson…'
        : launchMode === 'retry'
          ? 'Starting a new attempt…'
          : 'Restoring your attempt…';
    return (
      <ContentState>
        <LoadingState variant="page" message={launchMessage} />
      </ContentState>
    );
  }

  const activity = lesson.activities[activityIndex];
  const submitted = attempt.answers.find((answer) => answer.activityId === activity.id);
  const pending = draft.pendingAnswers.find((answer) => answer.activityId === activity.id);
  const completingSyncedLesson = draft.pendingCompletion && saveState === 'saving';
  const visibleSubmitted = completingSyncedLesson ? undefined : submitted;
  const visiblePendingAnswer =
    pending?.answer ?? (completingSyncedLesson ? submitted?.answer : undefined);
  const progressPercent = Math.round(
    ((activityIndex + (submitted ? 1 : 0)) / lesson.activities.length) * 100,
  );

  const submit = async (answer: ActivityAnswer) => {
    setSaveState('saving');
    try {
      const next = queueLessonAnswer(draft, activity.id, activity.type, answer, activityIndex);
      await saveLessonDraft(next);
      applyDraft(next);
      const online = navigator.onLine;
      setSaveState(online ? 'saving' : 'pending');
      if (online) {
        audibleAnswerIdRef.current = activity.id;
        await synchronizerRef.current?.flush();
        if (audibleAnswerIdRef.current === activity.id) audibleAnswerIdRef.current = null;
      }
    } catch {
      setSaveState('error');
    }
  };

  const continueLesson = async () => {
    if (!submitted && !pending) return;
    if (activityIndex === lesson.activities.length - 1) {
      try {
        if (draft.pendingCompletion) {
          if (navigator.onLine) await synchronizerRef.current?.flush();
          return;
        }
        const next = markLessonDraftPendingCompletion(draft);
        await saveLessonDraft(next);
        applyDraft(next);
        setSaveState(navigator.onLine ? 'saving' : 'pending');
        await flushActiveTime();
        if (navigator.onLine) await synchronizerRef.current?.flush();
      } catch {
        setSaveState('error');
      }
      return;
    }
    try {
      const next = updateLessonDraftPosition(draft, activityIndex + 1);
      await saveLessonDraft(next);
      applyDraft(next);
    } catch {
      setSaveState('error');
    }
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
            {saveState === 'pending' && 'Saved on this device · Waiting to sync'}
            {saveState === 'error' && 'Could not save. Try again.'}
          </span>
        </header>
        <div className="lesson-progress" aria-label={`${progressPercent}% complete`}>
          <span style={{ width: `${progressPercent}%` }} />
        </div>
        <main className="lesson-player__stage">
          <div className="lesson-player__activity-column">
            <ActivityCharacterAssistant
              activity={activity}
              submitted={visibleSubmitted}
              hintVisible={hintActivityId === activity.id}
              characterId={lesson.characterId}
            />
            {activity.type === 'find-word' ? (
              <FindWordActivityView
                key={activity.id}
                activity={activity}
                submitted={visibleSubmitted}
                pendingAnswer={
                  typeof visiblePendingAnswer === 'string' ? visiblePendingAnswer : undefined
                }
                onSubmit={submit}
                onHintVisibilityChange={(visible) =>
                  setHintActivityId(visible ? activity.id : null)
                }
              />
            ) : (
              <OrganizeTranslateActivityView
                key={activity.id}
                activity={activity}
                submitted={visibleSubmitted}
                pendingAnswer={
                  Array.isArray(visiblePendingAnswer) ? visiblePendingAnswer : undefined
                }
                onSubmit={submit}
                onHintVisibilityChange={(visible) =>
                  setHintActivityId(visible ? activity.id : null)
                }
              />
            )}
          </div>
          {(submitted || (pending && saveState === 'pending')) && !completingSyncedLesson && (
            <aside
              className={`answer-feedback ${submitted ? `answer-feedback--${submitted.isCorrect ? 'correct' : 'incorrect'}` : ''}`}
              role="status"
            >
              <div className="answer-feedback__symbol" aria-hidden="true">
                {submitted ? (submitted.isCorrect ? '✓' : '!') : '↻'}
              </div>
              <div>
                <p className="answer-feedback__status">
                  {submitted
                    ? submitted.isCorrect
                      ? 'Correct'
                      : 'Not quite'
                    : 'Saved on this device'}
                </p>
                {submitted ? (
                  <>
                    <h2>{activity.explanation.title}</h2>
                    <p>{activity.explanation.body}</p>
                  </>
                ) : (
                  <p>
                    Your answer is waiting for a connection. ALTRAS will check it when it syncs.
                  </p>
                )}
              </div>
              <Button
                onPointerDown={playNeutralClickOnPointerDown}
                onKeyDown={playNeutralClickOnKeyDown}
                onClick={() => void continueLesson()}
              >
                {activityIndex === lesson.activities.length - 1
                  ? draft.pendingCompletion
                    ? 'Retry sync'
                    : 'See results'
                  : 'Continue'}
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
          Your lesson progress is saved on this device and synchronized with your account when a
          connection is available.
        </ConfirmDialog>
      </div>
    </ContentState>
  );
}
