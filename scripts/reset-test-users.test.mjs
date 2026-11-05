import { describe, expect, it } from 'vitest';
import { buildResetPlan } from './reset-test-users.mjs';

describe('test-user reset planning', () => {
  const users = [
    { id: 'admin-id' },
    { id: 'researcher-id' },
    { id: 'student-id' },
    { id: 'unprofiled-id' },
  ];
  const profiles = [
    { user_id: 'admin-id', username: 'admin' },
    { user_id: 'researcher-id', username: 'testresearcher' },
    { user_id: 'student-id', username: 'student' },
  ];

  it('preserves only the requested Auth users and schedules all others for deletion', () => {
    expect(buildResetPlan(users, profiles)).toEqual({
      preserve: [
        { id: 'admin-id', username: 'admin' },
        { id: 'researcher-id', username: 'testresearcher' },
      ],
      remove: [{ id: 'student-id' }, { id: 'unprofiled-id' }],
    });
  });

  it('fails closed if either protected account is missing or ambiguous', () => {
    expect(() => buildResetPlan(users, profiles.filter((profile) => profile.username !== 'admin')))
      .toThrow('Expected exactly one Auth account and profile for admin');
    expect(() => buildResetPlan(users, [...profiles, { user_id: 'student-id', username: 'admin' }]))
      .toThrow('Expected exactly one Auth account and profile for admin');
  });
});
