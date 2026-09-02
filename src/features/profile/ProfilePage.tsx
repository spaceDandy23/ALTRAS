import { useEffect, useState, type FormEvent } from 'react';
import { ZodError } from 'zod';
import { BackLink } from '@/components/ui/BackLink';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Panel } from '@/components/ui/Panel';
import { getProfile, updateDisplayName } from './profile.service';
import { useAuthStore } from '@/stores/auth.store';

export function ProfilePage() {
  const user = useAuthStore((state) => state.user);
  const replaceUser = useAuthStore((state) => state.replaceUser);
  const [displayNameState, setDisplayNameState] = useState({
    userId: user?.id ?? '',
    value: user?.displayName ?? '',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let active = true;
    void getProfile(user.id)
      .then((profile) => {
        if (active) setDisplayNameState({ userId: user.id, value: profile.displayName });
      })
      .catch(() => {
        if (active) setError('Unable to load the online profile. Try refreshing.');
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(''), 2200);
    return () => window.clearTimeout(timeout);
  }, [message]);

  if (!user) return null;
  const displayName =
    displayNameState.userId === user.id ? displayNameState.value : user.displayName;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      const result = await updateDisplayName(user.id, displayName);
      replaceUser(result.user);
      setMessage('Profile saved.');
    } catch (cause) {
      setError(
        cause instanceof ZodError
          ? 'Use a display name between 2 and 40 characters.'
          : 'Could not save the online profile. Check your connection and try again.',
      );
    }
  };

  return (
    <div className="standard-page page-enter">
      <BackLink />
      <div className="page-heading">
        <h1>Profile</h1>
        <p>Manage the student name shown in ALTRAS.</p>
      </div>
      <div className="profile-layout">
        <Panel className="profile-badge" accent="blue">
          <div className="profile-badge__avatar" aria-hidden="true">
            {user.displayName.slice(0, 1).toLocaleUpperCase()}
          </div>
          <h2>{user.displayName}</h2>
          <span>@{user.normalizedUsername}</span>
          <div className="profile-badge__meta">
            <span>Online account</span>
            <span>Created {new Date(user.createdAt).toLocaleDateString()}</span>
          </div>
        </Panel>
        <Panel className="profile-editor">
          <h2>Display name</h2>
          <form onSubmit={(event) => void handleSubmit(event)}>
            <FormField
              label="Display name"
              value={displayName}
              onChange={(event) =>
                setDisplayNameState({ userId: user.id, value: event.target.value })
              }
              error={error}
              maxLength={40}
            />
            {message && (
              <p className="success-message" role="status">
                ✓ {message}
              </p>
            )}
            <Button type="submit">Save changes</Button>
          </form>
          <div className="profile-editor__username">
            <span>Username</span>
            <strong>{user.normalizedUsername}</strong>
            <small>Your username identifies this account and cannot be changed.</small>
          </div>
        </Panel>
      </div>
    </div>
  );
}
