import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const authorizationMigration = readFileSync(
  resolve('supabase/migrations/202608310001_researcher_results.sql'),
  'utf8',
);
const cleanupMigration = readFileSync(
  resolve('supabase/migrations/202609080001_researcher_role_cleanup.sql'),
  'utf8',
);

describe('researcher role cleanup migration', () => {
  it('keeps researcher_users as the authority before removing the profile role', () => {
    const currentResearcherFunction = authorizationMigration.slice(
      authorizationMigration.indexOf('create or replace function public.is_researcher()'),
      authorizationMigration.indexOf('-- Researchers must use the anonymized RPC below.'),
    );

    expect(currentResearcherFunction).toContain('from public.researcher_users');
    expect(currentResearcherFunction).not.toContain('from public.profiles');
    expect(cleanupMigration).toContain("to_regclass('public.researcher_users')");
    expect(cleanupMigration).toContain('drop column if exists role');
    expect(cleanupMigration).toContain('drop type if exists public.app_role');
  });
});
