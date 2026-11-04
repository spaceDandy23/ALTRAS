import { useEffect, useState } from 'react';
import { ResearcherContentLoading } from './ResearcherContentLoading';
import {
  getResearcherLessonAssessmentResults,
  type ResearcherLessonAssessmentResult,
} from './researcher.service';
import { formatResearchPercent, formatResearchPoints } from './researcher-format';

export function ResearcherAssessmentsPage() {
  const [lessonResults, setLessonResults] = useState<ResearcherLessonAssessmentResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void getResearcherLessonAssessmentResults()
      .then((results) => {
        if (active) setLessonResults(results);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <ResearcherContentLoading message="Loading lesson assessment results…" />;
  if (error)
    return (
      <section className="researcher-state panel" role="alert">
        <p className="researcher-kicker">Assessments</p>
        <h1>Lesson assessment results unavailable</h1>
        <p>{error}</p>
      </section>
    );

  return (
    <section className="researcher-results page-enter" aria-labelledby="assessment-analysis-title">
      <header className="researcher-results__heading">
        <div>
          <p className="researcher-kicker">Assessments</p>
          <h1 id="assessment-analysis-title">Lesson assessment results</h1>
          <p>Compare each lesson’s Pre-test and Post-test separately.</p>
        </div>
      </header>
      <section className="researcher-directory panel" aria-labelledby="lesson-assessment-results-title">
        <div className="researcher-directory__heading">
          <div>
            <h2 id="lesson-assessment-results-title">Per-lesson comparison</h2>
            <p>Only assessments attached to a lesson are shown here.</p>
          </div>
        </div>
        {lessonResults.length === 0 ? (
          <div className="researcher-empty">
            <h3>No lesson assessment results yet</h3>
            <p>Results will appear here after students complete lesson assessments.</p>
          </div>
        ) : (
          <div className="researcher-table-wrap" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Lesson</th>
                  <th>Participant</th>
                  <th>Pre-test</th>
                  <th>Post-test</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {lessonResults.map((result) => (
                  <tr key={`${result.lessonId}:${result.participantCode}`}>
                    <td>{result.lessonTitle}</td>
                    <td><strong>{result.participantCode}</strong> · {result.username}</td>
                    <td>{formatScore(result.preTestScore)} · {formatStatus(result.preTestStatus)}</td>
                    <td>{formatScore(result.postTestScore)} · {formatStatus(result.postTestStatus)}</td>
                    <td>
                      {result.preTestScore === null || result.postTestScore === null
                        ? 'Not available'
                        : formatResearchPoints(result.postTestScore - result.preTestScore)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

const formatScore = (value: number | null) => formatResearchPercent(value, 'Not completed');
const formatStatus = (value: string) =>
  value === 'completed' ? 'Completed' : value === 'in_progress' ? 'In progress' : 'Not started';