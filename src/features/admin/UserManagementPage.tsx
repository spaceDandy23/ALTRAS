import { useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormField } from '@/components/ui/FormField';
import {
  ADMIN_USER_PAGE_SIZE,
  listAdminUsers,
  provisionAdminUser,
  setAdminAccess,
  setResearcherAccess,
  setUserBanned,
  type AdminUser,
  type AdminUserPage,
} from './user-management.service';

type PendingAction = { kind: 'ban' | 'researcher' | 'admin'; enabled: boolean; user: AdminUser };
const emptyProvision = {
  email: '',
  password: '',
  username: '',
  displayName: '',
  researcher: false,
  admin: false,
};
function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
    : 'Never';
}

export function UserManagementPage() {
  const [result, setResult] = useState<AdminUserPage | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestKey = JSON.stringify([search, page, revision]);
  const [loadedRequestKey, setLoadedRequestKey] = useState('');
  const loading = loadedRequestKey !== requestKey;
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [provision, setProvision] = useState(emptyProvision);
  const [provisioning, setProvisioning] = useState(false);

  useEffect(() => {
    let current = true;
    void listAdminUsers(search, page)
      .then((data) => {
        if (!current) return;
        setResult(data);
        setError('');
      })
      .catch((cause: Error) => {
        if (current) setError(cause.message);
      })
      .finally(() => {
        if (current) setLoadedRequestKey(requestKey);
      });
    return () => {
      current = false;
    };
  }, [page, requestKey, search]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(query.trim());
  };
  const createUser = async (event: FormEvent) => {
    event.preventDefault();
    if (provisioning) return;
    setProvisioning(true);
    setError('');
    setNotice('');
    try {
      await provisionAdminUser(provision);
      setProvision(emptyProvision);
      setPage(1);
      setSearch('');
      setQuery('');
      setRevision((value) => value + 1);
      setNotice('Account provisioned. Profile and default settings were created automatically.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to provision account.');
    } finally {
      setProvisioning(false);
    }
  };
  const confirmAction = async () => {
    if (!pending) return;
    const action = pending;
    setPending(null);
    setError('');
    setNotice('');
    try {
      if (action.kind === 'ban') await setUserBanned(action.user.id, action.enabled);
      else if (action.kind === 'researcher')
        await setResearcherAccess(action.user.id, action.enabled);
      else await setAdminAccess(action.user.id, action.enabled);
      setRevision((value) => value + 1);
      setNotice(`${action.user.username ?? action.user.email ?? 'Account'} updated.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update account.');
    }
  };
  const actionCopy = pending
    ? pending.kind === 'ban'
      ? pending.enabled
        ? [
            'Deactivate account?',
            'Deactivate',
            'The user will be banned from signing in. Existing profile, progress and research data will remain intact.',
          ]
        : [
            'Reactivate account?',
            'Reactivate',
            'The user will be allowed to sign in again. Existing data will remain unchanged.',
          ]
      : pending.kind === 'researcher'
        ? pending.enabled
          ? [
              'Grant researcher access?',
              'Grant access',
              'The account will enter the view-only researcher experience after its next experience refresh.',
            ]
          : [
              'Revoke researcher access?',
              'Revoke access',
              'The account and its existing data will remain intact.',
            ]
        : pending.enabled
          ? [
              'Grant admin access?',
              'Grant access',
              'The account will be able to manage users and lessons.',
            ]
          : [
              'Revoke admin access?',
              'Revoke access',
              'The final active administrator cannot be removed.',
            ]
    : ['', '', ''];
  const lastPage = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <section aria-labelledby="admin-users-title">
      <p className="researcher-kicker">Administrator workspace</p>
      <h1 id="admin-users-title">User Management</h1>
      <p>
        Provision accounts, manage access, and deactivate sign-in without deleting learning or
        research data.
      </p>
      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-notice" role="status">
          {notice}
        </p>
      )}

      <section className="admin-panel" aria-labelledby="provision-heading">
        <h2 id="provision-heading">Provision account</h2>
        <form onSubmit={(event) => void createUser(event)}>
          <fieldset className="admin-editor" disabled={provisioning}>
            <legend>New account details</legend>
            <div className="admin-fields">
              <FormField
                label="Auth email"
                type="email"
                required
                autoComplete="off"
                value={provision.email}
                onChange={(event) => setProvision({ ...provision, email: event.target.value })}
              />
              <FormField
                label="Temporary password"
                type="password"
                required
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                hint="8–72 characters with a letter and number"
                value={provision.password}
                onChange={(event) => setProvision({ ...provision, password: event.target.value })}
              />
              <FormField
                label="Username (optional)"
                autoComplete="off"
                value={provision.username}
                hint="Leave blank to generate safely from the Auth identity"
                onChange={(event) => setProvision({ ...provision, username: event.target.value })}
              />
              <FormField
                label="Display name (optional)"
                autoComplete="off"
                value={provision.displayName}
                hint="Leave blank to use the existing profile fallback"
                onChange={(event) =>
                  setProvision({ ...provision, displayName: event.target.value })
                }
              />
            </div>
            <div className="admin-checks">
              <label>
                <input
                  type="checkbox"
                  checked={provision.researcher}
                  onChange={(event) =>
                    setProvision({ ...provision, researcher: event.target.checked })
                  }
                />{' '}
                Grant researcher access
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={provision.admin}
                  onChange={(event) => setProvision({ ...provision, admin: event.target.checked })}
                />{' '}
                Grant admin access
              </label>
            </div>
            <button className="button" type="submit">
              {provisioning ? 'Provisioning…' : 'Provision account'}
            </button>
          </fieldset>
        </form>
      </section>

      <section className="admin-panel" aria-labelledby="accounts-heading">
        <div className="admin-section-heading">
          <div>
            <h2 id="accounts-heading">Accounts</h2>
            <p>
              {result
                ? `${result.total} matching account${result.total === 1 ? '' : 's'}`
                : 'Loading accounts…'}
            </p>
          </div>
          <form className="admin-search" role="search" onSubmit={submitSearch}>
            <FormField
              label="Search users"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Username, display name, or email"
            />
            <button className="button button--quiet" type="submit">
              Search
            </button>
          </form>
        </div>
        {loading ? (
          <p role="status">Loading users…</p>
        ) : result && result.users.length ? (
          <div className="admin-table admin-user-table">
            <table>
              <caption>
                Authorized account directory, page {result.page} of {lastPage}
              </caption>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Auth email</th>
                  <th>Created</th>
                  <th>Last sign-in</th>
                  <th>Status</th>
                  <th>Access</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {result.users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.displayName ?? 'Profile incomplete'}</strong>
                      <span>@{user.username ?? 'unavailable'}</span>
                    </td>
                    <td>{user.email ?? 'No email'}</td>
                    <td>{date(user.createdAt)}</td>
                    <td>{date(user.lastSignInAt)}</td>
                    <td>
                      <span
                        className={`admin-status admin-status--${user.banned ? 'banned' : 'active'}`}
                      >
                        {user.banned ? 'Banned' : 'Active'}
                      </span>
                    </td>
                    <td>
                      <span>Researcher: {user.researcher ? 'Yes' : 'No'}</span>
                      <span>Admin: {user.admin ? 'Yes' : 'No'}</span>
                    </td>
                    <td>
                      <div className="admin-user-actions">
                        <button
                          type="button"
                          onClick={() => setPending({ kind: 'ban', enabled: !user.banned, user })}
                        >
                          {user.banned ? 'Reactivate' : 'Deactivate'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPending({ kind: 'researcher', enabled: !user.researcher, user })
                          }
                        >
                          {user.researcher ? 'Revoke researcher' : 'Grant researcher'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPending({ kind: 'admin', enabled: !user.admin, user })}
                        >
                          {user.admin ? 'Revoke admin' : 'Grant admin'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No accounts match this search.</p>
        )}
        <div className="admin-pagination" aria-label="User list pagination">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <span>
            Page {result?.page ?? page} of {lastPage} · {ADMIN_USER_PAGE_SIZE} per page
          </span>
          <button
            type="button"
            disabled={page >= lastPage || loading}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      </section>
      <ConfirmDialog
        open={pending !== null}
        title={actionCopy[0]}
        confirmLabel={actionCopy[1]}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmAction()}
      >
        {actionCopy[2]}
      </ConfirmDialog>
    </section>
  );
}
