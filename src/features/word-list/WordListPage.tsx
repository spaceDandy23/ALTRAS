import { useEffect, useMemo, useState } from 'react';
import { BackLink } from '@/components/ui/BackLink';
import { LoadingState } from '@/components/ui/LoadingState';
import type { ReferenceEntry } from '@/features/lessons/domain/content.schemas';
import { VocabularyTable } from '@/features/lessons/components/VocabularyTable';
import { listMathWordEntries } from './word-list.service';

export function WordListPage() {
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<ReferenceEntry[] | null>(null);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    setEntries(null);
    void listMathWordEntries()
      .then(setEntries)
      .catch(() => setError('Unable to load the Math Word List.'));
  };
  useEffect(load, []);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('en-US');
    if (!query) return entries ?? [];
    return (entries ?? []).filter((entry) =>
      [entry.term, entry.definition, entry.example].some((value) =>
        value.toLocaleLowerCase('en-US').includes(query),
      ),
    );
  }, [entries, search]);

  if (entries === null && !error) return <LoadingState variant="page" />;

  return (
    <div className="standard-page word-list-page page-enter">
      <BackLink to="/lessons/almanac" label="Back to Almanac" />
      <header className="word-list-heading">
        <div>
          <h1>Math Word List</h1>
          <p>Common words and phrases used when translating verbal expressions.</p>
        </div>
        <label className="word-list-search">
          <span>Search the word list</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Try “sum” or “less than”"
          />
        </label>
      </header>
      {error ? (
        <section className="word-list-empty">
          <h2>Math Word List unavailable</h2>
          <p>{error}</p>
          <button className="button button--primary" type="button" onClick={load}>Try again</button>
        </section>
      ) : filtered.length ? (
        <VocabularyTable title="Math Word List" rows={filtered} />
      ) : (
        <section className="word-list-empty">
          <h2>No matching words</h2>
          <p>Try another term, definition, or example.</p>
          <button className="button button--quiet" type="button" onClick={() => setSearch('')}>Clear search</button>
        </section>
      )}
    </div>
  );
}
