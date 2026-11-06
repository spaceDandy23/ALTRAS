import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';

export const preservedUsernames = Object.freeze(['admin', 'testresearcher']);

/** Build a fail-closed reset plan from Auth users and their profile usernames. */
export function buildResetPlan(users, profiles) {
  const usersById = new Map(users.map((user) => [user.id, user]));
  if (usersById.size !== users.length) throw new Error('Auth returned duplicate user IDs.');

  const keep = new Map();
  for (const username of preservedUsernames) {
    const matches = profiles.filter((profile) => profile.username === username);
    if (matches.length !== 1 || !usersById.has(matches[0].user_id)) {
      throw new Error(`Expected exactly one Auth account and profile for ${username}; no users were changed.`);
    }
    keep.set(matches[0].user_id, username);
  }

  return {
    preserve: [...keep].map(([id, username]) => ({ id, username })),
    remove: users.filter((user) => !keep.has(user.id)).map((user) => ({ id: user.id })),
  };
}

async function listAllAuthUsers(client) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not list Auth users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function loadProfiles(client, users) {
  const profiles = [];
  for (let offset = 0; offset < users.length; offset += 500) {
    const ids = users.slice(offset, offset + 500).map((user) => user.id);
    if (!ids.length) continue;
    const { data, error } = await client.from('profiles').select('user_id,username').in('user_id', ids);
    if (error) throw new Error(`Could not inspect profiles: ${error.message}`);
    profiles.push(...data);
  }
  return profiles;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--confirm-reset')) {
    throw new Error('Usage: node scripts/reset-test-users.mjs [--confirm-reset]');
  }
  const confirmed = args.includes('--confirm-reset');
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
  }

  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const users = await listAllAuthUsers(client);
  const profiles = await loadProfiles(client, users);
  const plan = buildResetPlan(users, profiles);

  console.log(`Preserving ${plan.preserve.map((user) => user.username).join(', ')}.`);
  console.log(`${plan.remove.length} other Auth account(s) scheduled for deletion.`);
  if (!confirmed) {
    console.log('Dry run only. Re-run with --confirm-reset to delete those accounts and their cascading user data.');
    return;
  }

  for (const user of plan.remove) {
    const { error } = await client.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`Could not delete Auth user ${user.id}: ${error.message}. Re-run after resolving the error; completed deletions are safe to repeat.`);
  }
  console.log('Reset complete. Auth user deletion cascades to linked profile, lesson, assessment, activity, score, and progression data.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
