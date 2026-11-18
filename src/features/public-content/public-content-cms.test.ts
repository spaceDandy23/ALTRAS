import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve('supabase/migrations/20261116190757_public_content_cms.sql'), 'utf8');

describe('public content CMS migration', () => {
  it('keeps drafts private and exposes only published content to visitors', () => {
    expect(sql).toContain('create table public.public_content_pages');
    expect(sql).toContain('alter table public.public_content_pages enable row level security');
    expect(sql).toContain('revoke all on public.public_content_pages from public, anon, authenticated');
    expect(sql).toContain('create or replace function public.get_public_content(p_page_key text)');
    expect(sql).toContain('grant execute on function public.get_public_content(text) to anon, authenticated');
    expect(sql).toContain("'content', page.published_content");
  });

  it('protects draft saving and publication behind staff authorization', () => {
    expect(sql).toContain('public.is_admin() or public.is_researcher()');
    expect(sql).toContain('if not public.is_public_content_manager() then');
    expect(sql).toContain('Content management access required.');
  });

  it('seeds legal drafts without publishing them', () => {
    expect(sql).toContain("'privacy-policy'");
    expect(sql).toContain("'terms-and-conditions'");
    expect(sql).toContain('researcher approval required before publication');
    expect(sql).toContain('insert into public.public_content_pages(page_key, draft_content)');
    expect(sql).toContain("another person''s information");
    expect(sql).not.toContain("person\\'s information");
  });
});
