import { useEffect, useState, type FormEvent } from 'react';
import { BackLink } from '@/components/ui/BackLink';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Panel } from '@/components/ui/Panel';
import { db } from '@/db/database';
import { getProfile, updateDisplayName } from './profile.service';
import { useAuthStore } from '@/stores/auth.store';

export function ProfilePage() {
  const user = useAuthStore((state) => state.user);
  const replaceUser = useAuthStore((state) => state.replaceUser);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    void getProfile(db, user.id).then((profile) => setDisplayName(profile.displayName));
  }, [user]);

  if (!user) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      const result = await updateDisplayName(db, user.id, displayName);
      replaceUser(result.user);
      setMessage('Profile saved on this device.');
    } catch {
      setError('Use a display name between 2 and 40 characters.');
    }
  };

  return (
    <div className="standard-page page-enter">
      <BackLink />
      <div className="page-heading">
        <p className="eyebrow">Your local identity</p>
        <h1>Student profile</h1>
        <p>Manage the name shown around ALTRAS.</p>
      </div>
      <div className="profile-layout">
        <Panel className="profile-badge" accent="blue">
          <div className="profile-badge__avatar" aria-hidden="true">
            {user.displayName.slice(0, 1).toLocaleUpperCase()}
          </div>
          <h2>{user.displayName}</h2>
          <span>@{user.normalizedUsername}</span>
          <div className="profile-badge__meta">
            <span>Local account</span>
            <span>Created {new Date(user.createdAt).toLocaleDateString()}</span>
          </div>
        </Panel>
        <Panel className="profile-editor">
          <p className="eyebrow">Edit profile</p>
          <h2>What should we call you?</h2>
          <form onSubmit={(event) => void handleSubmit(event)}>
            <FormField
              label="Display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
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
            <small>Usernames identify local accounts and cannot be changed in Phase 1.</small>
          </div>
        </Panel>
      </div>
    </div>
  );
}
