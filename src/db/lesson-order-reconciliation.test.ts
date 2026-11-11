import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('supabase/migrations/202611120001_reconcile_lesson_catalog_orders.sql'),
  'utf8',
);

describe('lesson order reconciliation migration', () => {
  it('repairs only the known temporary draft orders while retaining the rest of each draft', () => {
    expect(migration).toContain("('lesson-operation-signals'::text, 2)");
    expect(migration).toContain("('lesson-order-matters'::text, 3)");
    expect(migration).toContain("catalog.draft::text ilike '%temporary%'");
    expect(migration).toContain("jsonb_set(catalog.draft, '{displayOrder}'");
    expect(migration).not.toMatch(/delete\s+from/i);
  });

  it('uses the published definition as the order source and names order conflicts', () => {
    expect(migration).toContain('get_admin_lesson_order_conflict');
    expect(migration).toContain("definition.presentation->>'displayOrder'");
    expect(migration).toContain("definition.presentation->>'title'");
    expect(migration).toContain("Lesson order % is already used by");
  });
});
