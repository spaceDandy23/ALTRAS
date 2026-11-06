import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '@/db/database';
import { captureSyncSession } from '@/services/sync-session';
import { syncPendingAssessmentDrafts } from '@/features/assessments/assessment-sync.service';
import { discoverPendingAssessmentDrafts } from '@/features/assessments/assessment-draft.service';
import type { AssessmentKind } from '@/types/assessment';
import { syncPendingLessonDrafts } from '../attempts/attempt.service';
import {
  LESSON_SYNC_RETRY_DELAYS,
  discoverPendingLessonDrafts,
} from '../attempts/lesson-draft.service';

type SyncState = 'idle' | 'pending' | 'syncing' | 'attention';
const SLOW_RETRY_DELAY = 60_000;

export function GlobalLessonSyncStatus({
  userId,
  excludedAttemptId,
  excludedAssessment,
}: {
  userId: string;
  excludedAttemptId?: string;
  excludedAssessment?: { assessment: AssessmentKind; lessonAttemptId?: string };
}) {
  const [status, updateStatus] = useState<{ userId: string; state: SyncState }>();
  const state = status?.userId === userId ? status.state : 'idle';

  useEffect(() => {
    const setState = (state: SyncState) => updateStatus({ userId, state });
    let disposed = false;
    let running = false;
    let requested = false;
    let retryIndex = 0;
    let retryTimer: number | undefined;

    const clearRetry = () => {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      retryTimer = undefined;
    };
    const scheduleRetry = (run: () => void) => {
      clearRetry();
      if (!navigator.onLine || document.visibilityState === 'hidden') return;
      const delay = LESSON_SYNC_RETRY_DELAYS[retryIndex++] ?? SLOW_RETRY_DELAY;
      retryTimer = window.setTimeout(run, delay);
    };
    const inspectPending = async () => {
      const found = await Promise.all([
        discoverPendingLessonDrafts(userId),
        discoverPendingAssessmentDrafts(userId),
      ]).catch(() => null);
      if (disposed) return;
      if (!found) {
        setState('attention');
        return;
      }
      const [lessons, assessments] = found;
      const pendingLessons = lessons.drafts.filter(
        (draft) => draft.attemptId !== excludedAttemptId,
      ).length;
      const pendingAssessments = assessments.drafts.filter(
        (draft) =>
          (!draft.lessonAttemptId || draft.syncStatus === 'pending_submission') &&
          !(
            excludedAssessment?.assessment === draft.assessment &&
            excludedAssessment.lessonAttemptId === draft.lessonAttemptId
          ),
      ).length;
      if (lessons.invalidDraftIds.length + assessments.invalidDraftIds.length > 0) {
        setState('attention');
      } else {
        setState(pendingLessons + pendingAssessments > 0 ? 'pending' : 'idle');
      }
    };
    const run = async (resetRetry = true) => {
      if (disposed) return;
      const isCurrent = captureSyncSession(userId);
      if (!isCurrent()) return;
      if (!navigator.onLine || document.visibilityState === 'hidden') {
        await inspectPending();
        return;
      }
      if (running) {
        requested = true;
        return;
      }
      if (resetRetry) retryIndex = 0;
      clearRetry();
      running = true;
      requested = false;
      const excludedLessons = excludedAttemptId ? new Set([excludedAttemptId]) : undefined;
      const onWorkFound = () => {
        if (!disposed && isCurrent()) setState('syncing');
      };
      try {
        await syncPendingLessonDrafts(userId, excludedLessons, onWorkFound);
        if (disposed || !isCurrent() || !navigator.onLine) return;
        const assessments = await syncPendingAssessmentDrafts(
          userId,
          undefined,
          onWorkFound,
          excludedAssessment,
        );
        if (disposed || !isCurrent() || !navigator.onLine) return;
        const lessons = await syncPendingLessonDrafts(userId, excludedLessons, onWorkFound);
        if (disposed || !isCurrent()) return;
        if (lessons.pending + assessments.pending + lessons.invalid + assessments.invalid === 0) {
          retryIndex = 0;
          setState('idle');
        } else {
          setState('attention');
          scheduleRetry(() => void run(false));
        }
      } catch {
        if (!disposed && isCurrent()) {
          setState('attention');
          scheduleRetry(() => void run(false));
        }
      } finally {
        running = false;
        if (requested && !disposed) void run(false);
      }
    };
    const onOnline = () => void run();
    const onOffline = () => {
      clearRetry();
      void inspectPending();
    };
    const onFocus = () => void run(false);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void run(false);
      else {
        clearRetry();
        void inspectPending();
      }
    };

    let lastWorkKey: string | undefined;
    const subscription = liveQuery(async () => {
      const [lessons, assessments] = await Promise.all([
        db.lessonDrafts.where('userId').equals(userId).toArray(),
        db.assessmentDrafts.where('userId').equals(userId).toArray(),
      ]);
      return JSON.stringify([
        lessons
          .filter((draft) => draft.syncStatus !== 'synced')
          .map(({ id, revision, syncStatus }) => [id, revision, syncStatus]),
        assessments
          .filter(
            (draft) =>
              draft.syncStatus !== 'synced' &&
              (!draft.lessonAttemptId || draft.syncStatus === 'pending_submission'),
          )
          .map(({ id, revision, syncStatus }) => [id, revision, syncStatus]),
      ]);
    }).subscribe({
      next: (key) => {
        if (lastWorkKey === undefined) {
          lastWorkKey = key;
          if (key !== '[[],[]]') void run(false);
          return;
        }
        if (key === lastWorkKey) return;
        lastWorkKey = key;
        void run(false);
      },
      error: () => {
        if (!disposed) setState('attention');
      },
    });

    void run();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      subscription.unsubscribe();
      clearRetry();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [excludedAssessment, excludedAttemptId, userId]);

  if (state === 'idle') return null;
  return (
    <p className={`global-sync-status global-sync-status--${state}`} role="status">
      {state === 'syncing' && 'Syncing progress\u2026'}
      {state === 'pending' && 'Progress saved on this device.'}
      {state === 'attention' && 'Progress sync needs attention. Retrying\u2026'}
    </p>
  );
}
