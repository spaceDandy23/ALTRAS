import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('supabase/migrations/20261118043855_landing_showcase_storage.sql'),
  'utf8',
);
const imageFunction = readFileSync(
  resolve('supabase/functions/public-content-image/index.ts'),
  'utf8',
);

describe('landing showcase storage migration', () => {
  it('keeps screenshots private and limits staff uploads to supported image assets', () => {
    expect(migration).toContain("'public-content-assets'");
    expect(migration).toContain('false,');
    expect(migration).toContain("array['image/jpeg', 'image/png', 'image/webp']::text[]");
    expect(migration).toContain('Public content managers can read private screenshots');
    expect(migration).toContain('Public content managers can upload private screenshots');
    expect(migration).toContain('public.is_public_content_manager()');
    expect(migration).not.toMatch(/for delete/i);
  });

  it('resolves only published image paths through the public reader', () => {
    expect(imageFunction).toContain("rpc('get_public_content', { p_page_key: 'landing' })");
    expect(imageFunction).not.toContain("from('public_content_pages')");
  });
});
