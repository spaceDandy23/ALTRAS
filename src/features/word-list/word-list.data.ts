import { z } from 'zod';

const wordListTermSchema = z.object({
  label: z.string().min(1),
  orderSensitive: z.boolean().optional(),
});

const wordListExampleSchema = z.object({
  phrase: z.string().min(1),
  expression: z.string().min(1),
});

export const wordListGroupSchema = z.object({
  id: z.enum(['addition', 'subtraction', 'multiplication', 'division']),
  name: z.string().min(1),
  symbol: z.string().min(1),
  symbolLabel: z.string().min(1),
  terms: z.array(wordListTermSchema).min(1),
  examples: z.array(wordListExampleSchema).min(1),
  guidance: z.array(z.string().min(1)).optional(),
});

export const wordListSchema = z.array(wordListGroupSchema).length(4);

const referenceData = [
  {
    id: 'addition',
    name: 'Addition',
    symbol: '+',
    symbolLabel: 'plus sign',
    terms: [
      { label: 'plus' },
      { label: 'sum' },
      { label: 'added to' },
      { label: 'more than' },
      { label: 'increased by' },
    ],
    examples: [{ phrase: 'five more than a number', expression: 'n + 5' }],
  },
  {
    id: 'subtraction',
    name: 'Subtraction',
    symbol: '−',
    symbolLabel: 'minus sign',
    terms: [
      { label: 'minus' },
      { label: 'difference' },
      { label: 'less than', orderSensitive: true },
      { label: 'subtracted from', orderSensitive: true },
      { label: 'decreased by' },
    ],
    examples: [
      { phrase: 'six less than a number', expression: 'n − 6' },
      { phrase: 'a number subtracted from twelve', expression: '12 − n' },
    ],
    guidance: [
      '“Less than” and “subtracted from” reverse the apparent spoken order: six less than a number is n − 6, and a number subtracted from twelve is 12 − n.',
      '“The difference of A and B” preserves the named order as A − B.',
    ],
  },
  {
    id: 'multiplication',
    name: 'Multiplication',
    symbol: '×',
    symbolLabel: 'multiplication sign',
    terms: [{ label: 'times' }, { label: 'product' }, { label: 'multiplied by' }, { label: 'of' }],
    examples: [{ phrase: 'the product of three and a number', expression: '3n' }],
  },
  {
    id: 'division',
    name: 'Division',
    symbol: '÷',
    symbolLabel: 'division sign',
    terms: [{ label: 'divided by' }, { label: 'quotient' }, { label: 'per' }, { label: 'ratio' }],
    examples: [{ phrase: 'the quotient of a number and four', expression: 'n ÷ 4' }],
    guidance: ['Division order matters: “the quotient of A and B” means A ÷ B.'],
  },
] satisfies z.input<typeof wordListSchema>;

export const mathWordGroups = wordListSchema.parse(referenceData);
export type MathWordGroup = z.infer<typeof wordListGroupSchema>;

export function filterMathWordGroups(
  groups: readonly MathWordGroup[],
  search: string,
): MathWordGroup[] {
  const query = search.trim().toLocaleLowerCase('en-US');
  if (!query) return [...groups];

  return groups.filter((group) =>
    [
      group.name,
      group.symbol,
      group.symbolLabel,
      ...group.terms.map((term) => term.label),
      ...group.examples.flatMap((example) => [example.phrase, example.expression]),
      ...(group.guidance ?? []),
    ].some((value) => value.toLocaleLowerCase('en-US').includes(query)),
  );
}
