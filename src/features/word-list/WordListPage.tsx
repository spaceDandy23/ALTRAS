import { useState } from 'react';
import { BackLink } from '@/components/ui/BackLink';
import { filterMathWordGroups, mathWordGroups } from './word-list.data';

export function WordListPage() {
  const [search, setSearch] = useState('');
  const groups = filterMathWordGroups(mathWordGroups, search);

  return (
    <div className="standard-page word-list-page page-enter">
      <BackLink to="/lessons/almanac" label="Back to Almanac" />
      <header className="word-list-heading">
        <div>
          <h1>Math word list</h1>
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

      {groups.length > 0 ? (
        <div className="word-list-groups" aria-live="polite">
          {groups.map((group) => (
            <section
              className={`word-list-group word-list-group--${group.id}`}
              key={group.id}
              aria-labelledby={`word-list-${group.id}`}
            >
              <header className="word-list-group__heading">
                <span
                  className="word-list-group__symbol"
                  role="img"
                  aria-label={`${group.name}: ${group.symbolLabel}`}
                >
                  {group.symbol}
                </span>
                <h2 id={`word-list-${group.id}`}>{group.name}</h2>
              </header>
              <table className="word-list-table">
                <caption>{group.name} translation reference</caption>
                <thead>
                  <tr>
                    <th scope="col">Words and phrases</th>
                    <th scope="col">Example</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <ul className="word-list-terms">
                        {group.terms.map((term) => (
                          <li key={term.label}>
                            <span>{term.label}</span>
                            {term.orderSensitive && <strong>Order-sensitive</strong>}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td>
                      <ul className="word-list-examples">
                        {group.examples.map((example) => (
                          <li key={example.phrase}>
                            <span>{example.phrase}</span>
                            <strong>{example.expression}</strong>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                </tbody>
              </table>
              {group.guidance && (
                <aside
                  className={`word-list-guidance ${group.id === 'subtraction' ? 'word-list-guidance--warning' : ''}`}
                  aria-label={
                    group.id === 'subtraction'
                      ? 'Order-sensitive subtraction guidance'
                      : `${group.name} order guidance`
                  }
                >
                  <strong>
                    {group.id === 'subtraction' ? 'Order warning' : 'Remember the order'}
                  </strong>
                  {group.guidance.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </aside>
              )}
            </section>
          ))}
        </div>
      ) : (
        <section className="word-list-empty" aria-live="polite">
          <h2>No matching words</h2>
          <p>Try an operation name, symbol, keyword, or example phrase.</p>
          <button className="button button--quiet" type="button" onClick={() => setSearch('')}>
            Clear search
          </button>
        </section>
      )}
    </div>
  );
}
