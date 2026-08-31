import { describe, expect, it } from 'vitest';
import { resolvePostLoginDestination } from './post-login-route';

describe('post-login routing', () => {
  it('sends an authorized researcher to researcher results', () => {
    expect(resolvePostLoginDestination('authorized', '/lessons/lesson-one')).toBe(
      '/researcher/results',
    );
  });

  it('sends a normal student to the requested student route', () => {
    expect(resolvePostLoginDestination('denied', '/lessons/lesson-one')).toBe(
      '/lessons/lesson-one',
    );
  });

  it('does not send a student back to a researcher-only route', () => {
    expect(resolvePostLoginDestination('denied', '/researcher/results')).toBe('/');
  });
});
