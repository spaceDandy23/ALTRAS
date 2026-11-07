import type { ContentTable, InstructionalContentBlock } from './content.schemas';

export type VocabularyBlock = Extract<InstructionalContentBlock, { type: 'vocabulary-table' }>;

export function newContentTable(): ContentTable {
  return {
    id: crypto.randomUUID(),
    title: '',
    columns: [
      { id: 'term', label: 'Term' },
      { id: 'definition', label: 'Definition' },
      { id: 'example', label: 'Example' },
    ],
    rows: [{ id: crypto.randomUUID(), cells: { term: '', definition: '', example: '' } }],
  };
}

export function vocabularyTables(block: VocabularyBlock): ContentTable[] {
  if (block.tables !== undefined) return block.tables;
  return [
    {
      id: block.id,
      title: block.title,
      columns: [
        { id: 'term', label: 'Term' },
        { id: 'definition', label: 'Definition' },
        { id: 'example', label: 'Example' },
      ],
      rows: block.rows.map(({ id, term, definition, example }) => ({
        id,
        cells: { term, definition, example },
      })),
    },
  ];
}
