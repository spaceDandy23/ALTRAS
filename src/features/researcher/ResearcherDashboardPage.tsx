import { useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { useResearcherData } from './ResearcherDataContext';
import { ResearcherContentLoading } from './ResearcherContentLoading';
import { calculateLessonSummaries, calculateResearcherSummary, calculateScoreDistribution } from './researcher.service';
import { ScoreComparisonChart, ScoreDistributionChart, SummaryCard } from './ResearcherResultsPage';

export function ResearcherDashboardPage() {
  const { participants, loading, error, retry } = useResearcherData();
  const summary = useMemo(() => calculateResearcherSummary(participants), [participants]);
  const distribution = useMemo(() => calculateScoreDistribution(participants), [participants]);
  const lessons = useMemo(() => calculateLessonSummaries(participants), [participants]);
  if (loading) return <ResearcherContentLoading message="Loading research dashboard…" />;
  if (error) return <section className="researcher-state panel"><p className="researcher-kicker">Research dashboard</p><h1>Dashboard unavailable</h1><p>{error}</p><Button onClick={retry}>Try again</Button></section>;
  return <section className="researcher-results page-enter" aria-labelledby="research-dashboard-title"><header className="researcher-results__heading"><div><p className="researcher-kicker">Research dashboard</p><h1 id="research-dashboard-title">Study overview</h1><p>High-level anonymized assessment outcomes and learning progress.</p></div></header>{participants.length === 0 ? <div className="researcher-empty panel"><h2>No participant data yet</h2><p>Metrics and charts will appear after participants begin activity.</p></div> : <><section className="researcher-summary" aria-label="Research summary"><SummaryCard label="Total participants" value={summary.participantCount} /><SummaryCard label="Pre-test completed" value={summary.preTestCompletedCount} /><SummaryCard label="Post-test completed" value={summary.postTestCompletedCount} /><SummaryCard label="Average pre-test" value={score(summary.averagePreTestScore)} /><SummaryCard label="Average post-test" value={score(summary.averagePostTestScore)} /><SummaryCard label="Average improvement" value={change(summary.averageScoreChange)} /><SummaryCard label="Overall completion" value={summary.assessmentCompletionRate === null ? 'Not available' : `${summary.assessmentCompletionRate.toFixed(0)}%`} /></section><section className="researcher-charts" aria-label="Research analytics"><ScoreComparisonChart preTestAverage={summary.averagePreTestScore} postTestAverage={summary.averagePostTestScore} /><ScoreDistributionChart distribution={distribution} /></section><section className="researcher-chart researcher-chart--lessons panel" aria-labelledby="dashboard-lessons"><div className="researcher-chart__heading"><div><p className="researcher-kicker">Lesson completion</p><h2 id="dashboard-lessons">Completion overview</h2></div></div>{lessons.length === 0 ? <p className="researcher-chart__empty">No lesson progress is available yet.</p> : <div className="lesson-overview-chart">{lessons.map((lesson) => <div key={lesson.lessonId} className="lesson-overview-chart__row"><span>{lesson.lessonId}</span><div className="score-comparison__track" aria-hidden="true"><i style={{ width: `${lesson.completionRate ?? 0}%` }} /></div><strong>{lesson.completionRate === null ? 'Not available' : `${lesson.completionRate.toFixed(0)}%`}</strong></div>)}</div>}</section></>}</section>;
}

const score = (value: number | null) => value === null ? 'Not available' : `${value.toFixed(1)}%`;
const change = (value: number | null) => value === null ? 'Not available' : `${value > 0 ? '+' : ''}${value.toFixed(1)} pts`;
