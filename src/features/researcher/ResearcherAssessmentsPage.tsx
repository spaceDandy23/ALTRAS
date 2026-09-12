import { useMemo, useState } from 'react';
import { useResearcherData } from './ResearcherDataContext';
import { ResearcherContentLoading } from './ResearcherContentLoading';
import { calculateResearcherSummary, calculateScoreDistribution } from './researcher.service';
import { ScoreComparisonChart, ScoreDistributionChart } from './ResearcherResultsPage';

export function ResearcherAssessmentsPage() {
  const { participants, loading, error } = useResearcherData();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'complete' | 'incomplete'>('all');
  const summary = useMemo(() => calculateResearcherSummary(participants), [participants]);
  const distribution = useMemo(() => calculateScoreDistribution(participants), [participants]);
  const rows = useMemo(() => participants.filter((participant) => { const complete = participant.preTestStatus === 'completed' && participant.postTestStatus === 'completed'; return participant.participantCode.includes(query.trim().toUpperCase()) && (filter === 'all' || (filter === 'complete' ? complete : !complete)); }), [filter, participants, query]);
  if (loading) return <ResearcherContentLoading message="Loading assessment analysis…" />;
  if (error) return <div className="researcher-empty panel"><h2>Assessment data unavailable</h2><p>{error}</p></div>;
  return <section className="researcher-results page-enter" aria-labelledby="assessment-analysis-title"><header className="researcher-results__heading"><div><p className="researcher-kicker">Assessments</p><h1 id="assessment-analysis-title">Pre-test and post-test performance</h1><p>Compare assessment outcomes and completion across anonymized participants.</p></div></header><section className="researcher-charts"><ScoreComparisonChart preTestAverage={summary.averagePreTestScore} postTestAverage={summary.averagePostTestScore} /><ScoreDistributionChart distribution={distribution} /></section><section className="researcher-directory panel"><div className="researcher-directory__heading"><div><h2>Assessment results</h2><p>{rows.length} matching participant(s)</p></div><label className="researcher-search"><span>Find participant code</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div><div className="researcher-controls"><label><span>Completion</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">All participants</option><option value="complete">Both completed</option><option value="incomplete">Incomplete</option></select></label></div>{rows.length === 0 ? <div className="researcher-empty"><h2>No matching assessment results</h2><p>No completed data matches the current filters.</p></div> : <div className="researcher-table-wrap" tabIndex={0}><table><thead><tr><th>Participant</th><th>Pre-test score</th><th>Pre-test status</th><th>Post-test score</th><th>Post-test status</th><th>Improvement</th><th>Completion</th></tr></thead><tbody>{rows.map((p) => <tr key={p.participantCode}><td><strong>{p.participantCode}</strong></td><td>{formatScore(p.preTestScore)}</td><td>{formatStatus(p.preTestStatus)}</td><td>{formatScore(p.postTestScore)}</td><td>{formatStatus(p.postTestStatus)}</td><td>{p.preTestScore === null || p.postTestScore === null ? 'Not available' : `${p.postTestScore - p.preTestScore > 0 ? '+' : ''}${p.postTestScore - p.preTestScore} pts`}</td><td>{p.preTestStatus === 'completed' && p.postTestStatus === 'completed' ? 'Complete' : 'Incomplete'}</td></tr>)}</tbody></table></div>}</section></section>;
}

const formatScore = (value: number | null) => value === null ? 'Not completed' : `${value}%`;
const formatStatus = (value: string) => value === 'completed' ? 'Completed' : value === 'in_progress' ? 'In progress' : 'Not started';
