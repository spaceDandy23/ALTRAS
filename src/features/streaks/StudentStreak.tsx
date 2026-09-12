import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import { getStudentStreak, type StudentStreak as StreakSnapshot } from './streak.service';
import './streak.css';

/** Mount result feedback only inside the final, successfully loaded result branch. */
export function StudentStreak({ attemptId }: { attemptId?: string }) {
  const user = useAuthStore((state) => state.user);
  const authStatus = useAuthStore((state) => state.status);
  const accessStatus = useResearcherAccessStore((state) => state.status);
  const accessUserId = useResearcherAccessStore((state) => state.userId);
  const studentId =
    authStatus === 'authenticated' && accessStatus === 'denied' && accessUserId === user?.id
      ? user.id
      : null;
  const key = `${studentId}:${attemptId ?? 'summary'}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    snapshot: StreakSnapshot | null;
    error: boolean;
  } | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!studentId) return;
    let active = true;
    let inFlight = false;
    let midnightTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      clearTimeout(midnightTimer);
      try {
        const snapshot = await getStudentStreak(studentId, attemptId);
        if (!active) return;
        setLoaded((previous) => ({
          key,
          snapshot: {
            ...snapshot,
            // Keep an already displayed confirmation stable while this result stays mounted.
            celebrate:
              snapshot.celebrate ||
              (previous?.key === key &&
                previous.snapshot?.last_activity_date === snapshot.last_activity_date &&
                snapshot.earned_today &&
                previous.snapshot.celebrate === true),
          },
          error: false,
        }));
        midnightTimer = setTimeout(() => void refresh(), snapshot.refresh_after_seconds * 1000);
      } catch {
        if (active) setLoaded({ key, snapshot: null, error: true });
      } finally {
        inFlight = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearTimeout(midnightTimer);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [studentId, attemptId, key, revision]);

  if (!studentId) return null;
  const current = loaded?.key === key ? loaded : null;
  const snapshot = current?.snapshot;
  if (attemptId) {
    if (!snapshot?.celebrate || !snapshot.earned_today) return null;
    return (
      <p className="streak-feedback" role="status">
        {snapshot.current_streak === 1
          ? 'Streak started!'
          : `${snapshot.current_streak} day streak!`}
      </p>
    );
  }

  return (
    <section className="student-streak" aria-label="Daily learning streak">
      {current?.error ? (
        <p>
          Streak unavailable.{' '}
          <button
            type="button"
            className="home-lessons-link"
            onClick={() => setRevision((value) => value + 1)}
          >
            Try again
          </button>
        </p>
      ) : !snapshot ? (
        <p role="status">Loading streak…</p>
      ) : (
        <>
          <strong>{snapshot.current_streak} day streak</strong>
          <span>
            Longest: {snapshot.longest_streak} {snapshot.longest_streak === 1 ? 'day' : 'days'}
          </span>
          <p>
            {snapshot.earned_today
              ? 'Today’s learning is complete.'
              : 'Finish a lesson today to keep learning daily.'}
          </p>
          <small>Days follow Philippine time (Asia/Manila).</small>
        </>
      )}
    </section>
  );
}
