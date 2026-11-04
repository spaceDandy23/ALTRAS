import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { ResearcherParticipantResult } from './researcher.service';
import { useResearcherData } from './ResearcherDataContext';
import { ResearcherContentLoading } from './ResearcherContentLoading';
import { formatResearchPercent } from './researcher-format';

type SortKey = 'participant' | 'lessons-completed' | 'latest-activity';
const sortLabels: Record<SortKey, string> = {
  participant: 'Participant code',
  'lessons-completed': 'Lessons completed',
  'latest-activity': 'Latest activity',
};
const PARTICIPANTS_PER_PAGE = 15;

function formatDate(value: number | null): string {
  if (!value) return 'No recorded activity';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
}

export function ResearcherResultsPage() {
  const { participants, loading, error, retry } = useResearcherData();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('participant');
  const [descending, setDescending] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const matchingParticipants = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('en-US');
    return participants
      .filter((participant) =>
        !normalizedQuery || participant.participantCode.toLocaleLowerCase('en-US').includes(normalizedQuery)
        || participant.username.toLocaleLowerCase('en-US').includes(normalizedQuery),
      )
      .sort((left, right) => {
        const comparison = sort === 'participant'
          ? left.participantCode.localeCompare(right.participantCode)
          : sort === 'lessons-completed'
            ? left.lessonsCompleted - right.lessonsCompleted
            : (left.latestActivityAt ?? -1) - (right.latestActivityAt ?? -1);
        return descending ? -comparison : comparison;
      });
  }, [descending, participants, query, sort]);
  const totalPages = Math.max(1, Math.ceil(matchingParticipants.length / PARTICIPANTS_PER_PAGE));
  const activePage = Math.min(currentPage, totalPages);
  const pageParticipants = matchingParticipants.slice(
    (activePage - 1) * PARTICIPANTS_PER_PAGE,
    activePage * PARTICIPANTS_PER_PAGE,
  );
  const selectedParticipant = participants.find((participant) => participant.participantCode === selectedCode);
  const closeDetails = useCallback(() => setSelectedCode(null), []);

  if (loading) return <ResearcherContentLoading message="Loading participant results…" />;
  if (error)
    return (
      <section className="researcher-state panel" aria-labelledby="researcher-results-error">
        <p className="researcher-kicker">Researcher results</p>
        <h1 id="researcher-results-error">Results are unavailable</h1>
        <p>{error}</p>
        <Button onClick={retry}>Try again</Button>
      </section>
    );

  return (
    <section className="researcher-results page-enter" aria-labelledby="researcher-results-title">
      <header className="researcher-results__heading">
        <div>
          <p className="researcher-kicker">Participants</p>
          <h1 id="researcher-results-title">Participant learning states</h1>
          <p>
            Participant codes remain the research identifier. This view also includes ALTRAS
            usernames, but not names, emails, authentication IDs, answers, or answer keys.
          </p>
        </div>
      </header>
      <section className="researcher-directory panel" aria-labelledby="participant-results-title">
        <div className="researcher-directory__heading">
          <div>
            <h2 id="participant-results-title">Participant results</h2>
            <p>{matchingParticipants.length} matching participant(s)</p>
          </div>
          <label className="researcher-search">
            <span>Find participant code or username</span>
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
        <div className="researcher-controls" aria-label="Participant sorting">
          <label>
            <span>Sort by</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
              {Object.entries(sortLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <Button variant="quiet" onClick={() => setDescending((value) => !value)}>
            {descending ? 'Descending' : 'Ascending'}
          </Button>
        </div>
        {participants.length === 0 ? (
          <div className="researcher-empty">
            <h2>No participant data yet</h2>
            <p>Lesson progress will appear after participants register and begin activity.</p>
          </div>
        ) : matchingParticipants.length === 0 ? (
          <div className="researcher-empty">
            <h2>No matching participants</h2>
            <p>Try a different participant code or username.</p>
          </div>
        ) : (
          <>
            <div className="researcher-table-wrap" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <SortableHeader label="Participant" active={sort === 'participant'} onClick={() => setSort('participant')} />
                    <SortableHeader label="Lessons" active={sort === 'lessons-completed'} onClick={() => setSort('lessons-completed')} />
                    <SortableHeader label="Latest activity" active={sort === 'latest-activity'} onClick={() => setSort('latest-activity')} />
                    <th scope="col"><span className="visually-hidden">Open details</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageParticipants.map((participant) => (
                    <tr key={participant.participantCode}>
                      <td><strong>{participant.participantCode}</strong> · {participant.username}</td>
                      <td>{participant.lessonsCompleted} / {participant.lessonsAvailable}</td>
                      <td>{formatDate(participant.latestActivityAt)}</td>
                      <td>
                        <Button variant="quiet" onClick={() => setSelectedCode(participant.participantCode)}>
                          View details
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="researcher-pagination" aria-label="Participant result pages">
              <Button variant="quiet" disabled={activePage === 1} onClick={() => setCurrentPage(Math.max(1, activePage - 1))}>Previous</Button>
              <p aria-live="polite">
                <strong>Page {activePage} of {totalPages}</strong>
                <span>Showing {(activePage - 1) * PARTICIPANTS_PER_PAGE + 1}–{Math.min(activePage * PARTICIPANTS_PER_PAGE, matchingParticipants.length)} of {matchingParticipants.length}</span>
              </p>
              <Button variant="quiet" disabled={activePage === totalPages} onClick={() => setCurrentPage(Math.min(totalPages, activePage + 1))}>Next</Button>
            </nav>
          </>
        )}
      </section>
      <Modal open={Boolean(selectedParticipant)} onClose={closeDetails} titleId="participant-detail-title" className="researcher-detail-modal">
        {selectedParticipant && <ParticipantDetail participant={selectedParticipant} onClose={closeDetails} />}
      </Modal>
    </section>
  );
}

function ParticipantDetail({ participant, onClose }: { participant: ResearcherParticipantResult; onClose: () => void }) {
  return (
    <div className="researcher-detail">
      <div className="researcher-detail__heading">
        <div>
          <p className="researcher-kicker">Read-only participant detail</p>
          <h2 id="participant-detail-title">{participant.participantCode} · {participant.username}</h2>
        </div>
        <Button variant="quiet" onClick={onClose} data-modal-initial-focus>Close details</Button>
      </div>
      <dl className="researcher-detail__summary">
        <div><dt>Latest activity</dt><dd>{formatDate(participant.latestActivityAt)}</dd></div>
      </dl>
      <h3>Lesson progress</h3>
      {participant.lessonResults.length === 0 ? (
        <p>No lesson progress has been recorded.</p>
      ) : (
        <ul className="researcher-lesson-list">
          {participant.lessonResults.map((lesson) => (
            <li key={lesson.lessonId}>
              <strong>{lesson.lessonId}</strong>
              <span>{lesson.status.replace('-', ' ')}</span>
              <span>Best {formatResearchPercent(lesson.bestScore)}</span>
              <span>Latest {formatResearchPercent(lesson.latestScore)}</span>
              <span>{lesson.attemptCount} attempt(s)</span>
              <span>Completed {formatDate(lesson.completedAt)}</span>
              <span>Active time {formatDuration(lesson.activeSeconds)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SortableHeader({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <th scope="col"><button className={active ? 'is-active' : ''} onClick={onClick}>{label}</button></th>;
}