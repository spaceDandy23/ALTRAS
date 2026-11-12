import type { ContentTable, ReferenceEntry } from '@/features/lessons/domain/content.schemas';

function ContentTableView({ table, index }: { table: ContentTable; index: number }) {
  return (
    <div
      className="content-table-wrap"
      role="region"
      aria-label={table.title || `Table ${index + 1}`}
      tabIndex={0}
    >
      <table className="content-table" aria-label={table.title || `Table ${index + 1}`}>
        {table.title && <caption>{table.title}</caption>}
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column.id} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.id}>
              {table.columns.map((column) => (
                <td key={column.id} data-label={column.label}>
                  {row.cells[column.id]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VocabularyTables({ tables }: { tables: ContentTable[] }) {
  return (
    <div className="content-tables">
      {tables.map((table, index) => (
        <ContentTableView key={table.id} table={table} index={index} />
      ))}
    </div>
  );
}

// The global Math Word List retains its existing fixed reference format.
export function VocabularyTable({ title, rows }: { title: string; rows: ReferenceEntry[] }) {
  return (
    <div className="vocabulary-table-wrap">
      <table className="vocabulary-table" aria-label={title}>
        <thead>
          <tr>
            <th scope="col">Term</th>
            <th scope="col">Definition</th>
            <th scope="col">Example</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" data-label="Term">
                {row.term}
              </th>
              <td data-label="Definition">{row.definition}</td>
              <td data-label="Example">{row.example}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
