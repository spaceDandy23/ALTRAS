import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve('src/styles/index.css'), 'utf8');

describe('assessment sync controls', () => {
  it('separates retry actions from the sync notice without changing every quiet button', () => {
    expect(styles).toMatch(
      /\.assessment-sync-note \+ \.button\s*\{[\s\S]*?margin-top:\s*0\.75rem;/,
    );
    expect(styles.match(/\.button--quiet\s*\{([\s\S]*?)\}/)?.[1]).not.toMatch(/margin-top:/);
  });
});
