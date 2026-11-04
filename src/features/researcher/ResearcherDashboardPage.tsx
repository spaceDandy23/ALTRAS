import { useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { useResearcherData } from './ResearcherDataContext';
import { ResearcherContentLoading } from './ResearcherContentLoading';
import { calculateLessonSummaries } from './researcher.service';
import { formatResearchPercent } from './researcher-format';

export function ResearcherDashboardPage() {
  const { participants, loading, error, retry } = useResearcherData();
  const lessons = useMemo(() => calculateLessonSummaries(participants), [participants]);
  const fullyCompleted = useMemo(
    () => participants.filter((participant) =>
      participant.lessonsAvailable > 0 && participant.lessonsCompleted === participant.lessonsAvailable
    ).length,
    [participants],
  );
  if (loading) return <ResearcherContentLoading message="Loading research dashboard…" />;
  if (error)
    return (
      <section className="researcher-state panel">
        <p className="researcher-kicker">Research dashboard</p>
        <h1>Dashboard unavailable</h1>
        <p>{error}</p>
        <Button onClick={retry}>Try again</Button>
      </section>
    );
  return (
    <section className="researcher-results page-enter" aria-labelledby="research-dashboard-title">
      <header className="researcher-results__heading">
        <div>
          <p className="researcher-kicker">Research dashboard</p>
          <h1 id="research-dashboard-title">Study overview</h1>
          <p>Authorized participant counts and lesson completion.</p>
        </div>
      </header>
      {participants.length === 0 ? (
        <div className="researcher-empty panel">
          <h2>No participant data yet</h2>
          <p>Lesson progress will appear after participants begin activity.</p>
        </div>
      ) : (
        <>
          <section className="researcher-summary" aria-label="Research summary">
            <article className="researcher-summary__card panel">
              <span>Total participants</span>
              <strong>{participants.length}</strong>
            </article>
            <article className="researcher-summary__card panel">
              <span>All available lessons completed</span>
              <strong>{fullyCompleted}</strong>
            </article>
          </section>
          <section
            className="researcher-chart researcher-chart--lessons panel"
            aria-labelledby="dashboard-lessons"
          >
            <div className="researcher-chart__heading">
              <div>
                <p className="researcher-kicker">Lesson completion</p>
                <h2 id="dashboard-lessons">Completion overview</h2>
              </div>
            </div>
            {lessons.length === 0 ? (
              <p className="researcher-chart__empty">No lesson progress is available yet.</p>
            ) : (
              <div className="lesson-overview-chart">
                {lessons.map((lesson) => (
                  <div key={lesson.lessonId} className="lesson-overview-chart__row">
                    <span>{lesson.lessonId}</span>
                    <div className="score-comparison__track" aria-hidden="true">
                      <i style={{ width: `${lesson.completionRate ?? 0}%` }} />
                    </div>
                    <strong>{formatResearchPercent(lesson.completionRate)}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}