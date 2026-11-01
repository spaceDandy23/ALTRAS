// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve('src/styles/index.css'), 'utf8');
const appShell = readFileSync(resolve('src/app/AppShell.tsx'), 'utf8');
const mobileStyles = styles.slice(
  styles.indexOf('@media (max-width: 800px)'),
  styles.indexOf('@media (min-width: 1800px)'),
);

describe('offline status responsive layout', () => {
  it('keeps the dot and full message readable below 800px', () => {
    expect(mobileStyles).toMatch(
      /[.]app-header\s*\{[^}]*flex-wrap:\s*wrap;[^}]*gap:/,
    );
    expect(mobileStyles).toMatch(
      /[.]app-header__tools\s*\{[^}]*min-width:\s*0;[^}]*flex-wrap:\s*wrap;/,
    );
    expect(mobileStyles).toMatch(
      /[.]app-header > [.]offline-status\s*\{[^}]*order:\s*3;[^}]*flex:\s*1 1 100%;[^}]*overflow-wrap:\s*anywhere;/,
    );
    expect(mobileStyles).not.toMatch(
      /[.]offline-status__message\s*\{[^}]*display:\s*none;/,
    );
    expect(styles).toMatch(
      /[.]offline-status__dot\s*\{[^}]*flex:\s*0 0 7px;/,
    );
    expect(appShell.indexOf('<OfflineStatus />')).toBeLessThan(
      appShell.indexOf('<div className="app-header__tools">'),
    );
  });
});
