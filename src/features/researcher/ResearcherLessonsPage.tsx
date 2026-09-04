import { useMemo } from 'react';
import { useResearcherData } from './ResearcherDataContext';
import { ResearcherContentLoading } from './ResearcherContentLoading';
import { calculateLessonSummaries } from './researcher.service';

export function ResearcherLessonsPage() {
  const { participants, loading, error } = useResearcherData();
  const lessons = useMemo(() => calculateLessonSummaries(participants), [participants]);
  if (loading) return <ResearcherContentLoading message="Loading lesson analysis…" />;
  if (error) return <div className="researcher-empty panel"><h2>Lesson data unavailable</h2><p>{error}</p></div>;
  return <section className="researcher-results page-enter" aria-labelledby="lesson-analysis-title"><header className="researcher-results__heading"><div><p className="researcher-kicker">Lessons</p><h1 id="lesson-analysis-title">Lesson progression</h1><p>See where participants start, complete, and repeat available lessons.</p></div></header>{lessons.length === 0 ? <div className="researcher-empty panel"><h2>No lesson progress yet</h2><p>Lesson analytics will appear after participants begin a lesson.</p></div> : <><section className="researcher-chart researcher-chart--lessons panel"><div className="researcher-chart__heading"><div><p className="researcher-kicker">Completion overview</p><h2>Completion rate by lesson</h2></div></div><div className="lesson-overview-chart">{lessons.map((lesson) => <div key={lesson.lessonId} className="lesson-overview-chart__row"><span>{lesson.lessonId}</span><div className="score-comparison__track" aria-hidden="true"><i style={{ width: `${lesson.completionRate ?? 0}%` }} /></div><strong>{lesson.completionRate === null ? 'Not available' : `${lesson.completionRate.toFixed(0)}%`}</strong></div>)}</div></section><section className="researcher-directory panel"><h2>Lesson analytics</h2><div className="researcher-table-wrap" tabIndex={0}><table><thead><tr><th>Lesson</th><th>Started</th><th>Completed</th><th>Completion rate</th><th>Average score</th><th>Average attempts</th></tr></thead><tbody>{lessons.map((lesson) => <tr key={lesson.lessonId}><td><strong>{lesson.lessonId}</strong></td><td>{lesson.studentsStarted}</td><td>{lesson.studentsCompleted}</td><td>{metric(lesson.completionRate, '%')}</td><td>{metric(lesson.averageScore, '%')}</td><td>{metric(lesson.averageAttempts)}</td></tr>)}</tbody></table></div></section></>}</section>;
}
const metric = (value: number | null, suffix = '') => value === null ? 'Not available' : `${value.toFixed(1)}${suffix}`;
