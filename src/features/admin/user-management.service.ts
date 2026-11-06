import { z } from 'zod';
import { getSupabaseClient } from '@/services/supabase.client';

export const ADMIN_USER_PAGE_SIZE = 20;
const adminUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  createdAt: z.string(),
  lastSignInAt: z.string().nullable(),
  banned: z.boolean(),
  researcher: z.boolean(),
  admin: z.boolean(),
});
const pageSchema = z.object({
  users: z.array(adminUserSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
const provisionedUserSchema = z.object({
  user: z.object({ id: z.string().uuid(), email: z.string().optional(), createdAt: z.string() }),
});
const statusResponseSchema = z.object({
  user: z.object({ id: z.string().uuid(), banned: z.boolean() }),
});

export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminUserPage = z.infer<typeof pageSchema>;
export interface ProvisionUserInput {
  email: string;
  password: string;
  username?: string;
  displayName?: string;
  researcher: boolean;
  admin: boolean;
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await getSupabaseClient().rpc(name, args);
  if (error) throw new Error(error.message || 'Unable to manage this account.');
  return data;
}

export async function listAdminUsers(search: string, page: number): Promise<AdminUserPage> {
  return pageSchema.parse(
    await rpc('admin_list_users', {
      p_search: search.trim() || null,
      p_page: page,
      p_page_size: ADMIN_USER_PAGE_SIZE,
    }),
  );
}

export async function setResearcherAccess(userId: string, enabled: boolean): Promise<void> {
  await rpc('admin_set_researcher_access', { p_user_id: userId, p_enabled: enabled });
}

export async function setAdminAccess(userId: string, enabled: boolean): Promise<void> {
  await rpc('admin_set_admin_access', { p_user_id: userId, p_enabled: enabled });
}

async function invokeAdminUsers(body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await getSupabaseClient().functions.invoke('admin-users', { body });
  if (error) {
    let message = error.message || 'The secure account service is unavailable.';
    const context = 'context' in error ? error.context : null;
    if (context instanceof Response) {
      try {
        const payload = (await context.clone().json()) as { error?: unknown };
        if (typeof payload.error === 'string') message = payload.error;
      } catch {
        // Keep the SDK's safe failure message when the response is not JSON.
      }
    }
    throw new Error(message);
  }
  return data;
}

export async function provisionAdminUser(input: ProvisionUserInput): Promise<string> {
  const data = provisionedUserSchema.parse(
    await invokeAdminUsers({
      action: 'provision',
      email: input.email.trim(),
      password: input.password,
      username: input.username?.trim() || undefined,
      displayName: input.displayName?.trim() || undefined,
      researcher: input.researcher,
      admin: input.admin,
    }),
  );
  return data.user.id;
}

export async function setUserBanned(userId: string, banned: boolean): Promise<void> {
  statusResponseSchema.parse(await invokeAdminUsers({ action: 'set-banned', userId, banned }));
}
