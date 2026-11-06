import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve('supabase/migrations/202611040004_vocabulary_word_list_star_thresholds.sql'),
  'utf8',
);

describe('vocabulary, Math Word List, and star threshold migration', () => {
  it('stores and secures global Math Word List entries', () => {
    expect(sql).toContain('create table public.math_word_list_entries');
    expect(sql).toContain('create or replace function public.get_math_word_list()');
    expect(sql).toContain('create or replace function public.save_math_word_list(p_entries jsonb)');
    expect(sql).toContain('if not public.is_admin()');
  });

  it('publishes the exact supplied Lesson 1 vocabulary including an incomplete Quantity row', () => {
    for (const term of ['Constant', 'Variable', 'Coefficient', 'Term', 'Base and Exponent', 'Quantity', 'Consecutive numbers']) {
      expect(sql).toContain(`'term','${term}'`);
    }
    expect(sql).toContain("'term','Quantity','definition','','example',''");
    expect(sql).toContain('A single fixed number');
    expect(sql).toContain('In x³, x is the base and 3 is the exponent');
    expect(sql).toContain('(9, 11, 13) are consecutive odd numbers');
  });

  it('uses the authoritative 50 and 76 percent star boundaries', () => {
    expect(sql).toMatch(/when computed_score\s*>=\s*76 then 2/);
    expect(sql).toMatch(/when computed_score\s*>=\s*50 then 1/);
  });
});
