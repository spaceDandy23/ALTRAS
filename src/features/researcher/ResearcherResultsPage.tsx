import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingState';
import { Modal } from '@/components/ui/Modal';
import {
  calculateResearcherSummary,
  getResearcherResults,
  type ResearcherParticipantResult,
} from './researcher.service';

type ParticipantFilter =
  'all' | 'pre-completed' | 'post-completed' | 'both-completed' | 'incomplete';

type SortKey =
  | 'participant'
  | 'pre-score'
  | 'post-score'
  | 'score-change'
  | 'lessons-completed'
  | 'latest-activity';

const filters: Array<{ id: ParticipantFilter; label: string }> = [
  { id: 'all', label: 'All participants' },
  { id: 'pre-completed', label: 'Pre-test completed' },
  { id: 'post-completed', label: 'Post-test completed' },
  { id: 'both-completed', label: 'Both completed' },
  { id: 'incomplete', label: 'Incomplete assessments' },
];

const sortLabels: Record<SortKey, string> = {
  participant: 'Participant code',
  'pre-score': 'Pre-test score',
  'post-score': 'Post-test score',
  'score-change': 'Score change',
  'lessons-completed': 'Lessons completed',
  'latest-activity': 'Latest activity',
};

const PARTICIPANTS_PER_PAGE = 15;

function formatScore(score: number | null): string {
  return score === null ? '—' : String(score) + '%';
}

function formatChange(participant: ResearcherParticipantResult): string {
  if (participant.preTestScore === null || participant.postTestScore === null) return '—';
  const change = participant.postTestScore - participant.preTestScore;
  return (change > 0 ? '+' : '') + String(change) + ' pts';
}

function formatDate(value: number | null): string {
  if (!value) return 'No recorded activity';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    value,
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return String(seconds) + ' sec';
  return String(Math.floor(seconds / 60)) + ' min ' + String(seconds % 60) + ' sec';
}

function assessmentLabel(status: ResearcherParticipantResult['preTestStatus']): string {
  if (status === 'completed') return 'Completed';
  if (status === 'in_progress') return 'In progress';
  return 'Not started';
}

function matchesFilter(
  participant: ResearcherParticipantResult,
  filter: ParticipantFilter,
): boolean {
  switch (filter) {
    case 'pre-completed':
      return participant.preTestStatus === 'completed';
    case 'post-completed':
      return participant.postTestStatus === 'completed';
    case 'both-completed':
      return (
        participant.preTestStatus === 'completed' && participant.postTestStatus === 'completed'
      );
    case 'incomplete':
      return (
        participant.preTestStatus !== 'completed' || participant.postTestStatus !== 'completed'
      );
    default:
      return true;
  }
}

function sortValue(participant: ResearcherParticipantResult, sort: SortKey): number | string {
  switch (sort) {
    case 'pre-score':
      return participant.preTestScore ?? -1;
    case 'post-score':
      return participant.postTestScore ?? -1;
    case 'score-change':
      return participant.preTestScore === null || participant.postTestScore === null
        ? -101
        : participant.postTestScore - participant.preTestScore;
    case 'lessons-completed':
      return participant.lessonsCompleted;
    case 'latest-activity':
      return participant.latestActivityAt ?? -1;
    default:
      return participant.participantCode;
  }
}

export function ResearcherResultsPage() {
  const [participants, setParticipants] = useState<ResearcherParticipantResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ParticipantFilter>('all');
  const [sort, setSort] = useState<SortKey>('participant');
  const [descending, setDescending] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void getResearcherResults()
      .then((loaded) => {
        if (active) {
          setParticipants(loaded);
          setError('');
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Unable to load researcher results.');
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [requestVersion]);

  const load = () => {
    setLoading(true);
    setError('');
    setRequestVersion((version) => version + 1);
  };

  const summary = useMemo(() => calculateResearcherSummary(participants), [participants]);
  const matchingParticipants = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleUpperCase('en-US');
    return participants
      .filter(
        (participant) =>
          matchesFilter(participant, filter) &&
          (!normalizedQuery || participant.participantCode.includes(normalizedQuery)),
      )
      .sort((left, right) => {
        const leftValue = sortValue(left, sort);
        const rightValue = sortValue(right, sort);
        const comparison =
          typeof leftValue === 'string' && typeof rightValue === 'string'
            ? leftValue.localeCompare(rightValue)
            : Number(leftValue) - Number(rightValue);
        return descending ? -comparison : comparison;
      });
  }, [descending, filter, participants, query, sort]);
  const totalPages = Math.max(1, Math.ceil(matchingParticipants.length / PARTICIPANTS_PER_PAGE));
  const activePage = Math.min(currentPage, totalPages);
  const pageParticipants = matchingParticipants.slice(
    (activePage - 1) * PARTICIPANTS_PER_PAGE,
    activePage * PARTICIPANTS_PER_PAGE,
  );
  const selectedParticipant = participants.find(
    (participant) => participant.participantCode === selectedCode,
  );

  const closeDetails = useCallback(() => setSelectedCode(null), []);

  const changeSort = (nextSort: SortKey) => {
    setCurrentPage(1);
    if (sort === nextSort) setDescending((value) => !value);
    else {
      setSort(nextSort);
      setDescending(false);
    }
  };

  if (loading) {
    return (
      <LoadingState
        className="researcher-loading"
        message="Loading anonymized participant results…"
      />
    );
  }

  if (error) {
    return (
      <section className="researcher-state panel" aria-labelledby="researcher-results-error">
        <p className="researcher-kicker">Researcher results</p>
        <h1 id="researcher-results-error">Results are unavailable</h1>
        <p>{error}</p>
        <Button onClick={load}>Try again</Button>
      </section>
    );
  }

  return (
    <section className="researcher-results page-enter" aria-labelledby="researcher-results-title">
      <header className="researcher-results__heading">
        <div>
          <p className="researcher-kicker">Researcher results</p>
          <h1 id="researcher-results-title">Anonymized participant outcomes</h1>
          <p>
            Participant identities are anonymized. This view does not include names, emails,
            authentication IDs, answers, or answer keys.
          </p>
        </div>
      </header>

      <section className="researcher-summary" aria-label="Research summary">
        <SummaryCard label="Participants" value={summary.participantCount} />
        <SummaryCard label="Pre-test completed" value={summary.preTestCompletedCount} />
        <SummaryCard label="Post-test completed" value={summary.postTestCompletedCount} />
        <SummaryCard label="Both assessments" value={summary.bothCompletedCount} />
        <SummaryCard label="Average pre-test" value={formatScore(summary.averagePreTestScore)} />
        <SummaryCard label="Average post-test" value={formatScore(summary.averagePostTestScore)} />
        <SummaryCard
          label="Average score change"
          value={
            summary.averageScoreChange === null
              ? '—'
              : (summary.averageScoreChange > 0 ? '+' : '') +
                summary.averageScoreChange.toFixed(1) +
                ' pts'
          }
        />
        <SummaryCard
          label="All available lessons"
          value={
            String(summary.allLessonsCompletedCount) + ' / ' + String(summary.participantCount)
          }
        />
      </section>

      <section className="researcher-directory panel" aria-labelledby="participant-results-title">
        <div className="researcher-directory__heading">
          <div>
            <h2 id="participant-results-title">Participant results</h2>
            <p>{matchingParticipants.length} matching participant(s)</p>
          </div>
          <label className="researcher-search">
            <span>Find participant code</span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCurrentPage(1);
              }}
              placeholder="ALT-8F21C4"
              type="search"
            />
          </label>
        </div>

        <div className="researcher-controls" aria-label="Participant filters and sorting">
          <label>
            <span>Assessment filter</span>
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value as ParticipantFilter);
                setCurrentPage(1);
              }}
            >
              {filters.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Sort by</span>
            <select value={sort} onChange={(event) => changeSort(event.target.value as SortKey)}>
              {Object.entries(sortLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="quiet"
            onClick={() => {
              setDescending((value) => !value);
              setCurrentPage(1);
            }}
          >
            {descending ? 'Descending' : 'Ascending'}
          </Button>
        </div>

        {participants.length === 0 ? (
          <div className="researcher-empty">
            <h2>No participant data yet</h2>
            <p>Results will appear here after participants register and begin activity.</p>
          </div>
        ) : matchingParticipants.length === 0 ? (
          <div className="researcher-empty">
            <h2>No matching participants</h2>
            <p>Try a different participant code or assessment filter.</p>
          </div>
        ) : (
          <>
            <div className="researcher-table-wrap" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <SortableHeader
                      label="Participant"
                      active={sort === 'participant'}
                      onClick={() => changeSort('participant')}
                    />
                    <SortableHeader
                      label="Pre-test"
                      active={sort === 'pre-score'}
                      onClick={() => changeSort('pre-score')}
                    />
                    <SortableHeader
                      label="Post-test"
                      active={sort === 'post-score'}
                      onClick={() => changeSort('post-score')}
                    />
                    <SortableHeader
                      label="Change"
                      active={sort === 'score-change'}
                      onClick={() => changeSort('score-change')}
                    />
                    <SortableHeader
                      label="Lessons"
                      active={sort === 'lessons-completed'}
                      onClick={() => changeSort('lessons-completed')}
                    />
                    <SortableHeader
                      label="Latest activity"
                      active={sort === 'latest-activity'}
                      onClick={() => changeSort('latest-activity')}
                    />
                    <th scope="col">
                      <span className="visually-hidden">Open details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageParticipants.map((participant) => (
                    <tr key={participant.participantCode}>
                      <td>
                        <strong>{participant.participantCode}</strong>
                      </td>
                      <td>
                        {assessmentLabel(participant.preTestStatus)} ·{' '}
                        {formatScore(participant.preTestScore)}
                      </td>
                      <td>
                        {assessmentLabel(participant.postTestStatus)} ·{' '}
                        {formatScore(participant.postTestScore)}
                      </td>
                      <td>{formatChange(participant)}</td>
                      <td>
                        {participant.lessonsCompleted} / {participant.lessonsAvailable}
                      </td>
                      <td>{formatDate(participant.latestActivityAt)}</td>
                      <td>
                        <Button
                          variant="quiet"
                          onClick={() => setSelectedCode(participant.participantCode)}
                        >
                          View details
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="researcher-pagination" aria-label="Participant result pages">
              <Button
                variant="quiet"
                disabled={activePage === 1}
                onClick={() => setCurrentPage(Math.max(1, activePage - 1))}
              >
                Previous
              </Button>
              <p aria-live="polite">
                <strong>
                  Page {activePage} of {totalPages}
                </strong>
                <span>
                  Showing {(activePage - 1) * PARTICIPANTS_PER_PAGE + 1}–
                  {Math.min(activePage * PARTICIPANTS_PER_PAGE, matchingParticipants.length)} of{' '}
                  {matchingParticipants.length}
                </span>
              </p>
              <Button
                variant="quiet"
                disabled={activePage === totalPages}
                onClick={() => setCurrentPage(Math.min(totalPages, activePage + 1))}
              >
                Next
              </Button>
            </nav>
          </>
        )}
      </section>

      <Modal
        open={Boolean(selectedParticipant)}
        onClose={closeDetails}
        titleId="participant-detail-title"
        className="researcher-detail-modal"
      >
        {selectedParticipant && (
          <div className="researcher-detail">
            <div className="researcher-detail__heading">
              <div>
                <p className="researcher-kicker">Read-only participant detail</p>
                <h2 id="participant-detail-title">{selectedParticipant.participantCode}</h2>
              </div>
              <Button variant="quiet" onClick={closeDetails} data-modal-initial-focus>
                Close details
              </Button>
            </div>
            <dl className="researcher-detail__summary">
              <div>
                <dt>Pre-test</dt>
                <dd>
                  {assessmentLabel(selectedParticipant.preTestStatus)} ·{' '}
                  {formatScore(selectedParticipant.preTestScore)}
                </dd>
              </div>
              <div>
                <dt>Post-test</dt>
                <dd>
                  {assessmentLabel(selectedParticipant.postTestStatus)} ·{' '}
                  {formatScore(selectedParticipant.postTestScore)}
                </dd>
              </div>
              <div>
                <dt>Score difference</dt>
                <dd>{formatChange(selectedParticipant)}</dd>
              </div>
              <div>
                <dt>Latest activity</dt>
                <dd>{formatDate(selectedParticipant.latestActivityAt)}</dd>
              </div>
            </dl>
            <h3>Lesson progress</h3>
            {selectedParticipant.lessonResults.length === 0 ? (
              <p>No lesson progress has been recorded.</p>
            ) : (
              <ul className="researcher-lesson-list">
                {selectedParticipant.lessonResults.map((lesson) => (
                  <li key={lesson.lessonId}>
                    <strong>{lesson.lessonId}</strong>
                    <span>{lesson.status.replace('-', ' ')}</span>
                    <span>Best {lesson.bestScore}%</span>
                    <span>Latest {formatScore(lesson.latestScore)}</span>
                    <span>{lesson.attemptCount} attempt(s)</span>
                    <span>Completed {formatDate(lesson.completedAt)}</span>
                    <span>Active time {formatDuration(lesson.activeSeconds)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="researcher-summary__card panel">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function SortableHeader({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <th scope="col">
      <button className={active ? 'is-active' : ''} onClick={onClick}>
        {label}
      </button>
    </th>
  );
}
