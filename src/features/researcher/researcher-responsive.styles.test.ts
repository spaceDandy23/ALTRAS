import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve('src/styles/index.css'), 'utf8');

describe('researcher workspace responsive styles', () => {
  it('bounds the shell and every researcher content layer to the viewport', () => {
    expect(styles).toMatch(
      /\.researcher-shell \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: clip;/,
    );
    expect(styles).toMatch(
      /\.researcher-main \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;[\s\S]*?overflow-x: clip;/,
    );
    expect(styles).toContain('.researcher-results > *');
    expect(styles).toMatch(
      /\.researcher-results \{[\s\S]*?width: 100%;[\s\S]*?max-width: 1320px;[\s\S]*?min-width: 0;/,
    );
  });

  it('keeps wide research tables inside their own keyboard-focusable scroll region', () => {
    expect(styles).toMatch(
      /\.researcher-table-wrap \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;[\s\S]*?overflow-x: auto;/,
    );
    expect(styles).toMatch(/\.researcher-table-wrap table \{[\s\S]*?min-width: 950px;/);
  });

  it('uses intermediate tablet grids before collapsing to the phone layout', () => {
    expect(styles).toMatch(
      /@media \(max-width: 1150px\) \{[\s\S]*?\.researcher-summary \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?\.researcher-charts \{[\s\S]*?grid-template-columns: 1fr;/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 960px\) \{[\s\S]*?\.researcher-sidebar \{[\s\S]*?display: none;[\s\S]*?\.researcher-mobile-nav \{[\s\S]*?display: block;/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 800px\) \{[\s\S]*?\.researcher-summary,[\s\S]*?\.researcher-charts,[\s\S]*?\.researcher-detail__summary \{[\s\S]*?grid-template-columns: 1fr;/,
    );
  });

  it('keeps the mobile update prompt within safe viewport edges', () => {
    expect(styles).toMatch(
      /@media \(max-width: 480px\) \{[\s\S]*?\.pwa-update-prompt \{[\s\S]*?right: 0\.75rem;[\s\S]*?left: 0\.75rem;[\s\S]*?max-width: none;[\s\S]*?max-height: calc\(100svh - 1\.5rem\);/,
    );
    expect(styles).toContain('body:has(.pwa-update-prompt) .researcher-main');
  });
});
