// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sharedStyles = readFileSync(resolve('src/styles/index.css'), 'utf8');
const adminStyles = readFileSync(
  resolve('src/features/admin/lesson-management.css'),
  'utf8',
);

describe('shared viewport layout stability', () => {
  it('reserves the document scrollbar gutter and keeps the grid at a stable origin', () => {
    expect(sharedStyles).toMatch(
      /html\s*\{[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/,
    );
    expect(sharedStyles).toMatch(
      /body\s*\{[\s\S]*?min-height: 100svh;[\s\S]*?overflow-y: visible;[\s\S]*?background-position: 0 0;[\s\S]*?background-attachment: fixed;/,
    );
    expect(sharedStyles).toMatch(/#root\s*\{[\s\S]*?overflow-y: visible;/);
  });

  it('keeps vertical page scrolling on the document across authenticated shells', () => {
    for (const selector of [
      '.auth-screen',
      '.app-shell',
      '.app-content',
      '.researcher-shell',
      '.researcher-main',
    ]) {
      expect(sharedStyles).toMatch(
        new RegExp(`${selector.replace('.', '[.]')}\\s*\\{[\\s\\S]*?overflow-y: visible;`),
      );
    }
    for (const selector of ['.admin-shell', '.admin-content']) {
      expect(adminStyles).toMatch(
        new RegExp(`${selector.replace('.', '[.]')}\\s*\\{[\\s\\S]*?overflow-y: visible;`),
      );
    }
  });

  it('anchors the algebraic backdrop to the viewport rather than route height', () => {
    expect(sharedStyles).toMatch(
      /\.algebraic-backdrop\s*\{[\s\S]*?position: fixed;[\s\S]*?inset: 0;/,
    );
  });

  it('uses the same small-viewport height for public and authenticated shells', () => {
    for (const selector of ['.auth-screen', '.auth-card', '.app-shell', '.researcher-shell']) {
      expect(sharedStyles).toMatch(
        new RegExp(`${selector.replace('.', '[.]')}\\s*\\{[\\s\\S]*?min-height: 100svh;`),
      );
    }
    expect(sharedStyles).toMatch(
      /\.researcher-sidebar\s*\{[\s\S]*?height: 100svh;/,
    );
    expect(adminStyles).toMatch(/\.admin-shell\s*\{[\s\S]*?min-height: 100svh;/);
    expect(adminStyles).toMatch(/\.admin-sidebar\s*\{[\s\S]*?height: 100svh;/);
  });
});
