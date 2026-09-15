// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const adminStyles = readFileSync(resolve('src/features/admin/lesson-management.css'), 'utf8');
const sharedStyles = readFileSync(resolve('src/styles/index.css'), 'utf8');

describe('Admin workspace layout styles', () => {
  it('uses a responsive sidebar and keeps a compact mobile navigation available', () => {
    expect(adminStyles).toContain('.admin-sidebar');
    expect(adminStyles).toContain('.admin-mobile-nav');
    expect(adminStyles).toContain('@media (max-width: 650px)');
  });

  it('keeps ordered tokens and user actions as distinct non-overlapping controls', () => {
    expect(adminStyles).toContain('.admin-token-order__item');
    expect(adminStyles).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(adminStyles).toContain('.admin-token-order__controls');
    expect(adminStyles).toContain('.admin-user-actions');
    expect(adminStyles).toContain('white-space: normal');
  });

  it('uses visible button boundaries without requiring a drop shadow', () => {
    expect(sharedStyles).toMatch(/\.button\s*\{[\s\S]*border: 2px solid var\(--line-strong\)/);
    expect(sharedStyles).toMatch(/\.button\s*\{[\s\S]*background: var\(--control-bg\)/);
    expect(adminStyles).toContain('border: 1px solid var(--line-strong)');
  });

  it('keeps account columns readable in a local scroll region on constrained desktops', () => {
    expect(adminStyles).toMatch(
      /\.admin-table\s*\{[\s\S]*max-width: 100%;[\s\S]*overflow-x: auto/,
    );
    expect(adminStyles).toMatch(
      /\.admin-user-table table\s*\{[\s\S]*min-width: 1000px;[\s\S]*table-layout: auto/,
    );
    expect(adminStyles).not.toContain('word-break: break-all');
  });

  it('turns account rows into labeled cards on phones', () => {
    expect(adminStyles).toMatch(
      /@media \(max-width: 650px\) \{[\s\S]*\.admin-user-table tbody\s*\{[\s\S]*display: grid;[\s\S]*\.admin-user-table td::before\s*\{[\s\S]*content: attr\(data-label\)/,
    );
    expect(adminStyles).toContain('.admin-user-table td[data-label="Actions"]');
  });

  it('centers admin page loading in a viewport layer', () => {
    expect(adminStyles).toMatch(
      /\.admin-content-loading\s*\{[\s\S]*position: fixed;[\s\S]*inset: 0;[\s\S]*min-height: 100svh;/,
    );
    expect(sharedStyles).toMatch(/#root\s*\{[\s\S]*min-height: 100svh;/);
  });

  it('keeps assessment tables locally scrollable and stacks question choices on phones', () => {
    expect(adminStyles).toMatch(
      /\.admin-assessment-table table\s*\{[\s\S]*?min-width: 760px;/,
    );
    expect(adminStyles).toMatch(
      /@media \(max-width: 650px\) \{[\s\S]*?\.admin-assessment-choice\s*\{[\s\S]*?grid-template-columns: 1fr;/,
    );
    expect(adminStyles).toMatch(/\.admin-table:focus-visible\s*\{[\s\S]*?outline:/);
  });
});
