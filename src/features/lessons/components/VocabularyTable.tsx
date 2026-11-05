import type { ReferenceEntry } from '@/features/lessons/domain/content.schemas';

export function VocabularyTable({ title, rows }: { title: string; rows: ReferenceEntry[] }) {
  return (
    <div className="vocabulary-table-wrap">
      <table className="vocabulary-table" aria-label={title}>
        <thead>
          <tr><th scope="col">Term</th><th scope="col">Definition</th><th scope="col">Example</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" data-label="Term">{row.term}</th>
              <td data-label="Definition">{row.definition}</td>
              <td data-label="Example">{row.example}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
