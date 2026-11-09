import { useCallback, useEffect, useRef, useState } from 'react';
import { captureSyncSession } from '@/services/sync-session';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageLoadError } from '@/components/ui/PageLoadError';
import { ActivityCharacterAssistant } from '@/features/characters/components/ActivityCharacterAssistant';
import { ChooseCorrectTranslationActivityView } from './activities/ChooseCorrectTranslationActivityView';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import type { LearningLesson } from './domain/content.schemas';
import type { LessonAttempt } from '@/types/learning';
import { getLesson } from './content/content.service';
import {
  completeAttempt,
  advanceAttemptStage,
  consumeLessonAttemptLaunchMode,
  getAttempt,
  recordAttemptActiveSeconds,
  submitActivityAnswer,
} from './attempts/attempt.service';
import {
  LessonDraftSynchronizer,
  acknowledgeLessonActiveTime,
  acknowledgeLessonAnswer,
  acknowledgeLessonStageTransition,
  acknowledgeLessonCompletion,
  getLessonDraft,
  markLessonDraftPendingCompletion,
  queueLessonAnswer,
  queueLessonActiveTime,
  queueLessonStageTransition,
  reconcileLessonDraft,
  saveLessonDraft,
  updateLessonDraftPosition,
  updateStoredLessonDraft,
  type LessonDraft,
} from './attempts/lesson-draft.service';
import { FindWordActivityView } from './activities/FindWordActivityView';
import { OrganizeTranslateActivityView } from './activities/OrganizeTranslateActivityView';
import type { ActivityAnswer } from './domain/evaluation';
import { chapterActivityPosition, hasChapterTeachingContent, lessonChapters } from './domain/lesson-flow';
import { ContentState } from './components/ContentState';
import { TeachingContentRenderer } from './components/TeachingContentRenderer';
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
  const stageAdvanceInFlightRef = useRef(false);
  const localActionInFlightRef = useRef(false);
  const [localSaving, setLocalSaving] = useState(false);
  const latestDraftRef = useRef<LessonDraft | null>(null);
  const draftId = draft?.id;

  const applyDraft = useCallback((next: LessonDraft) => {
    const current = latestDraftRef.current;
    if (current?.id === next.id && current.revision > next.revision) return;
    latestDraftRef.current = next;
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
          applyDraft(next);
          if (navigator.onLine) synchronizerRef.current?.requestSync();
        });
      activeTimeFlushRef.current = run;
      return run;
    },
    [applyDraft, draftId],
  );

  useEffect(() => {
    if (!user || contentStatus !== 'ready') return;
    let current = true;
    void getLessonDraft(user.id, lessonId, attemptId)
      .then(async (local) => {
        if (local) {
          if (!current) return;
          if (local.attempt.status === 'completed') {
            navigate(`/lessons/${lessonId}/result/${attemptId}`, { replace: true });
            return;
          }
          if (local.attempt.flowStage === 'pre-test' || local.attempt.flowStage === 'post-test') {
            navigate(
              `/lessons/${lessonId}/play/${attemptId}/assessment/${local.attempt.flowStage}`,
              { replace: true },
            );
            return;
          }
          applyDraft(local);
          setLoadError('');
          setLoadedFor(loadKey);
          setSaveState(local.syncStatus === 'synced' ? 'saved' : 'pending');
          return;
        }
        if (!navigator.onLine) throw new Error('No saved lesson attempt is available.');
        const remote = await Promise.all([
          getLesson(db, lessonId, attemptId),
          getAttempt(db, user.id, attemptId),
        ]);
        const [loadedLesson, loadedAttempt] = remote;
        if (loadedAttempt.lessonId !== loadedLesson.id) throw new Error('Attempt mismatch.');
        if (loadedAttempt.status === 'completed') {
          if (current) navigate(`/lessons/${lessonId}/result/${attemptId}`, { replace: true });
          return;
        }
        let next = reconcileLessonDraft(loadedAttempt, loadedLesson, local);
        if (loadedAttempt.flowStage === 'chapter-activity' && loadedAttempt.currentChapterId) {
          const chapter = lessonChapters(loadedLesson).find(
            (item) => item.id === loadedAttempt.currentChapterId,
          );
          const currentActivity = loadedLesson.activities[next.currentActivityIndex];
          if (chapter && !chapter.activities.some((item) => item.id === currentActivity?.id)) {
            const firstPending =
              chapter.activities.find(
                (item) => !loadedAttempt.answers.some((answer) => answer.activityId === item.id),
              ) ?? chapter.activities[0];
            const flatIndex = loadedLesson.activities.findIndex(
              (item) => item.id === firstPending?.id,
            );
            if (flatIndex >= 0) next = updateLessonDraftPosition(next, flatIndex);
          }
        }
        if (
          loadedAttempt.flowStage === 'ready-to-complete' ||
          ((!loadedAttempt.flowStage || loadedAttempt.flowStage === 'legacy-activity') &&
            loadedAttempt.answers.length >= loadedLesson.activities.length)
        ) {
          next = markLessonDraftPendingCompletion(next);
        }
        await saveLessonDraft(next);
        if (!current) return;
        if (next.attempt.flowStage === 'pre-test' || next.attempt.flowStage === 'post-test') {
          navigate(`/lessons/${lessonId}/play/${attemptId}/assessment/${next.attempt.flowStage}`, {
            replace: true,
          });
          return;
        }
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
    let active = true;
    const isCurrent = captureSyncSession(user.id);
    const canApply = () => active && isCurrent();
    const synchronizer = new LessonDraftSynchronizer({
      isCurrent: canApply,
      attemptId,
      load: () => getLessonDraft(user.id, lessonId, attemptId),
      recordActiveTime: (_snapshot, segment) =>
        recordAttemptActiveSeconds(db, attemptId, segment.seconds, segment.id),
      acknowledgeActiveTime: async (snapshot, segment) => {
        const next = await acknowledgeLessonActiveTime(snapshot.id, segment.id);
        if (next && canApply()) {
          applyDraft(next);
        }
      },
      advanceStage: (snapshot, transition) =>
        advanceAttemptStage(snapshot.attemptId, transition.fromStage, transition.fromChapterId),
      acknowledgeStage: async (snapshot, transition, serverAttempt) => {
        const next = await acknowledgeLessonStageTransition(snapshot.id, transition, serverAttempt);
        if (!next || !canApply()) return;
        applyDraft(next);
        if (next.attempt.flowStage === 'pre-test' || next.attempt.flowStage === 'post-test') {
          navigate(
            `/lessons/${next.lessonId}/play/${next.attemptId}/assessment/${next.attempt.flowStage}`,
            { replace: true },
          );
        }
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
        const releasedLesson = await getLesson(db, snapshot.lessonId, snapshot.attemptId);
        const next = await acknowledgeLessonAnswer(
          snapshot.id,
          answer,
          serverAttempt,
          db,
          releasedLesson,
        );
        if (!next || !canApply()) return;
        const submittedAnswer = serverAttempt.answers.find(
          (item) => item.activityId === answer.activityId,
        );
        const current = latestDraftRef.current;
        const shouldPlayAnswerSfx =
          audibleAnswerIdRef.current === answer.activityId &&
          current?.lesson.activities[current.currentActivityIndex]?.id === answer.activityId;
        if (shouldPlayAnswerSfx) audibleAnswerIdRef.current = null;
        if (submittedAnswer && shouldPlayAnswerSfx) {
          playSfx(submittedAnswer.isCorrect ? 'correct' : 'incorrect');
        }
        applyDraft(next);
      },
      complete: (snapshot) => completeAttempt(db, snapshot.attemptId),
      onCompleted: async (snapshot, completed) => {
        if (!canApply()) return;
        // The synchronizer has already drained every queued time segment
        // before completion. Stop the live timer before route cleanup so it
        // cannot create a new segment for an attempt the server just closed.
        activeSegmentStartedAt.current = null;
        await acknowledgeLessonCompletion(snapshot, completed);
        if (!canApply()) return;
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
      active = false;
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

  const activeAttemptId = attempt?.status === 'active' ? attempt.id : null;
  useEffect(() => {
    if (!activeAttemptId) return;
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
  }, [activeAttemptId, flushActiveTime]);

  useEffect(() => {
    if (attempt?.flowStage === 'pre-test' || attempt?.flowStage === 'post-test') {
      navigate(`/lessons/${lessonId}/play/${attemptId}/assessment/${attempt.flowStage}`, {
        replace: true,
      });
    }
  }, [attempt?.flowStage, attemptId, lessonId, navigate]);

  const emptyTeachingChapter = attempt?.flowStage === 'chapter-teaching' && lesson
    ? lessonChapters(lesson).find((chapter) => chapter.id === attempt.currentChapterId)
    : null;
  const skipEmptyTeaching = !!draft && !!emptyTeachingChapter && !hasChapterTeachingContent(emptyTeachingChapter);
  useEffect(() => {
    if (!skipEmptyTeaching || loadedFor !== loadKey || !draft || stageAdvanceInFlightRef.current) return;
    stageAdvanceInFlightRef.current = true;
    void queueLessonStageTransition(draft.id, db, Date.now(), 'chapter-teaching')
      .then((next) => {
        applyDraft(next);
        if (navigator.onLine) synchronizerRef.current?.requestSync();
      })
      .catch(() => setLoadError('Your lesson step could not be restored.'))
      .finally(() => { stageAdvanceInFlightRef.current = false; });
  }, [applyDraft, draft, loadKey, loadedFor, skipEmptyTeaching]);

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

  if (skipEmptyTeaching) {
    return <ContentState><LoadingState variant="page" /></ContentState>;
  }

  const stage = attempt.flowStage ?? 'legacy-activity';
  const chapters = lessonChapters(lesson);
  const currentChapter =
    chapters.find((chapter) => chapter.id === attempt.currentChapterId) ?? chapters[0];
  const chapterIndex = chapters.findIndex((chapter) => chapter.id === currentChapter.id);

  const exit = () => {
    if (attempt.answers.length > 0 || stage !== 'legacy-activity') setConfirmExit(true);
    else navigate(`/lessons/${lesson.id}`);
  };

  const continueTeaching = async () => {
    if (stageAdvanceInFlightRef.current) return;
    stageAdvanceInFlightRef.current = true;
    setLocalSaving(true);
    try {
      await flushActiveTime();
      const next = await queueLessonStageTransition(draft.id);
      applyDraft(next);
      setSaveState(navigator.onLine ? 'saving' : 'pending');
      if (navigator.onLine) synchronizerRef.current?.requestSync();
    } catch {
      setSaveState('error');
    } finally {
      stageAdvanceInFlightRef.current = false;
      setLocalSaving(false);
    }
  };

  if (stage === 'chapter-teaching') {
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
                Chapter {chapterIndex + 1} of {chapters.length}
              </strong>
            </div>
            <span className={`lesson-player__save-state lesson-player__save-state--${saveState}`}>
              {saveState === 'saving' && 'Saving…'}
              {saveState === 'saved' && 'Saved'}
              {saveState === 'pending' && 'Saved on this device. Account sync is pending.'}
              {saveState === 'error' && 'Could not continue. Try again.'}
            </span>
          </header>
          <main className="chapter-teaching panel" aria-labelledby="chapter-teaching-title">
            <p className="assessment-kicker">Chapter {chapterIndex + 1}</p>
            <h1 id="chapter-teaching-title">{currentChapter.title}</h1>
            {currentChapter.description && <p>{currentChapter.description}</p>}
            <TeachingContentRenderer
              blocks={currentChapter.instructionalContent.filter(
                (block) => block.type !== 'vocabulary-table',
              )}
            />
            <div className="chapter-teaching__actions">
              <Button
                onPointerDown={playNeutralClickOnPointerDown}
                onKeyDown={playNeutralClickOnKeyDown}
                onClick={() => void continueTeaching()}
                disabled={localSaving}
              >
                {currentChapter.activities.length ? 'Start chapter activities' : 'Continue'}
              </Button>
            </div>
          </main>
          <ConfirmDialog
            open={confirmExit}
            title="Exit and resume later?"
            confirmLabel="Exit lesson"
            onCancel={() => setConfirmExit(false)}
            onConfirm={() => navigate(`/lessons/${lesson.id}`)}
          >
            Your place is saved on this device and syncs when a connection is available.
          </ConfirmDialog>
        </div>
      </ContentState>
    );
  }

  if (stage === 'ready-to-complete') {
    return (
      <ContentState>
        <LoadingState variant="page" message="Finishing your lesson…" />
      </ContentState>
    );
  }

  if (stage === 'pre-test' || stage === 'post-test') {
    return (
      <ContentState>
        <LoadingState
          variant="page"
          message={
            navigator.onLine
              ? `Opening the ${stage}â€¦`
              : `Your ${stage} will open after reconnecting.`
          }
        />
      </ContentState>
    );
  }

  const activity = lesson.activities[activityIndex];
  const submitted = attempt.answers.find((answer) => answer.activityId === activity.id);
  const pending = draft.pendingAnswers.find((answer) => answer.activityId === activity.id);
  const completingSyncedLesson = draft.pendingCompletion && saveState === 'saving';
  const showPendingFeedback =
    Boolean(pending) && (!navigator.onLine || saveState === 'pending' || saveState === 'error');
  const visibleSubmitted = completingSyncedLesson ? undefined : submitted;
  const visiblePendingAnswer =
    pending?.answer ?? (completingSyncedLesson ? submitted?.answer : undefined);
  const progressPercent = Math.round(
    ((activityIndex + (submitted ? 1 : 0)) / lesson.activities.length) * 100,
  );
  const correctAnswer = (() => {
    if (activity.type === 'organize-translate') {
      return activity.correctTokenSequence
        ?.map((tokenId) => activity.tokens.find((token) => token.id === tokenId)?.label)
        .filter((label): label is string => Boolean(label))
        .join(' ') || null;
    }
    return activity.choices.find((choice) => choice.id === activity.correctChoiceId)?.label ?? null;
  })();

  const submit = async (answer: ActivityAnswer) => {
    if (localActionInFlightRef.current) return;
    localActionInFlightRef.current = true;
    try {
      const next = await updateStoredLessonDraft(draft.id, (current) =>
        queueLessonAnswer(current, activity.id, activity.type, answer, activityIndex),
      );
      applyDraft(next);
      setSaveState(navigator.onLine ? 'saving' : 'pending');
      if (navigator.onLine) {
        audibleAnswerIdRef.current = activity.id;
        synchronizerRef.current?.requestSync();
      }
    } catch {
      setSaveState('error');
    } finally {
      localActionInFlightRef.current = false;
    }
  };

  const continueLesson = async () => {
    if (!submitted && !pending) return;
    audibleAnswerIdRef.current = null;
    if (stage === 'chapter-activity') {
      const position = chapterActivityPosition(lesson, currentChapter.id, activity.id);
      if (!position) {
        setSaveState('error');
        return;
      }
      if (!position.isLastInChapter) {
        try {
          const nextActivity = currentChapter.activities[position.activityIndex + 1];
          const nextIndex = lesson.activities.findIndex((item) => item.id === nextActivity.id);
          const next = await updateStoredLessonDraft(draft.id, (current) =>
            updateLessonDraftPosition(current, nextIndex),
          );
          applyDraft(next);
        } catch {
          setSaveState('error');
        }
        return;
      }
      if (stageAdvanceInFlightRef.current) return;
      stageAdvanceInFlightRef.current = true;
      try {
        await flushActiveTime();
        const next = await queueLessonStageTransition(draft.id);
        applyDraft(next);
        setSaveState(navigator.onLine ? 'saving' : 'pending');
        if (navigator.onLine) synchronizerRef.current?.requestSync();
      } catch {
        setSaveState('error');
      } finally {
        stageAdvanceInFlightRef.current = false;
      }
      return;
    }
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
        // Include the final active segment in the ordered sync, then pause
        // tracking. Completion closes the server attempt immediately after.
        // eslint-disable-next-line react-hooks/purity -- This event handler closes the active-time window at submit time.
        await flushActiveTime(Date.now(), true);
        if (navigator.onLine) await synchronizerRef.current?.flush();
      } catch {
        setSaveState('error');
      }
      return;
    }
    try {
      const next = await updateStoredLessonDraft(draft.id, (current) =>
        updateLessonDraftPosition(current, activityIndex + 1),
      );
      applyDraft(next);
    } catch {
      setSaveState('error');
    }
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
              {stage === 'chapter-activity'
                ? `Chapter ${chapterIndex + 1} of ${chapters.length} · Activity ${
                    currentChapter.activities.findIndex((item) => item.id === activity.id) + 1
                  } of ${currentChapter.activities.length}`
                : `Activity ${activityIndex + 1} of ${lesson.activities.length}`}
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
        <div className="lesson-progress-row">
          <div className="lesson-progress" aria-label={`${progressPercent}% complete`}>
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          <span
            className="lesson-progress__count"
            aria-label={`Activity ${activityIndex + 1} of ${lesson.activities.length}`}
          >
            {activityIndex + 1} / {lesson.activities.length}
          </span>
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
            ) : activity.type === 'organize-translate' ? (
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
            ) : (
              <ChooseCorrectTranslationActivityView
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
            )}
          </div>
          {(submitted || showPendingFeedback) && !completingSyncedLesson && (
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
                    {!submitted.isCorrect && correctAnswer && (
                      <p className="answer-feedback__correct-answer">
                        <strong>Correct answer:</strong> {correctAnswer}
                      </p>
                    )}
                    {activity.explanation?.title && <h2>{activity.explanation.title}</h2>}
                    {activity.explanation?.body && (
                      <p className="answer-feedback__explanation">{activity.explanation.body}</p>
                    )}
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
