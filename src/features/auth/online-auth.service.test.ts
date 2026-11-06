import { describe, expect, it } from 'vitest';
import { usernameToAuthEmail } from './online-auth.service';

describe('online authentication identifiers', () => {
  it('maps normalized usernames to private internal auth identifiers', () => {
    expect(usernameToAuthEmail('  Student_01  ')).toBe('student_01@students.altras.invalid');
  });

  it('uses the same identifier regardless of username casing', () => {
    expect(usernameToAuthEmail('ALTRAS-USER')).toBe(usernameToAuthEmail('altras-user'));
  });
});
