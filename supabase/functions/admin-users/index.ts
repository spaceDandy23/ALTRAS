import { createClient } from '@supabase/supabase-js';

const allowedOrigins = new Set(
  (Deno.env.get('ALTRAS_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const baseCorsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function corsHeaders(origin: string | null) {
  return origin && allowedOrigins.has(origin)
    ? { ...baseCorsHeaders, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : baseCorsHeaders;
}

function response(status: number, body: Record<string, unknown>, origin: string | null) {
  return Response.json(body, { status, headers: corsHeaders(origin) });
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('Optional account fields must be text.');
  return value.trim() || undefined;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin');
  if (origin && !allowedOrigins.has(origin))
    return response(403, { error: 'Origin not allowed.' }, null);
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' }, origin);

  const url = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !publicKey || !serviceRoleKey || allowedOrigins.size === 0)
    return response(500, { error: 'Server configuration is incomplete.' }, origin);
  if (!authorization?.startsWith('Bearer '))
    return response(401, { error: 'Authentication required.' }, origin);

  const token = authorization.slice('Bearer '.length);
  const userClient = createClient(url, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: identity, error: identityError } = await userClient.auth.getUser(token);
  if (identityError || !identity.user)
    return response(401, { error: 'Authentication required.' }, origin);
  const { data: allowed, error: accessError } = await userClient.rpc('is_admin');
  if (accessError || allowed !== true)
    return response(403, { error: 'Admin access required.' }, origin);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return response(400, { error: 'Invalid request.' }, origin);
  }

  if (body.action === 'provision') {
    try {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const username = optionalText(body.username)?.toLowerCase();
      const displayName = optionalText(body.displayName);
      if (!email || email.length > 320 || !/^\S+@\S+\.\S+$/.test(email))
        return response(400, { error: 'Enter a valid email address.' }, origin);
      if (
        password.length < 8 ||
        password.length > 72 ||
        !/[a-z]/i.test(password) ||
        !/\d/.test(password)
      ) {
        return response(
          400,
          { error: 'Password must be 8–72 characters and include a letter and number.' },
          origin,
        );
      }
      if (username && !/^[a-z0-9_-]{3,24}$/.test(username))
        return response(
          400,
          { error: 'Username must use 3–24 lowercase letters, numbers, _ or -.' },
          origin,
        );
      if (displayName && (displayName.length < 2 || displayName.length > 40))
        return response(400, { error: 'Display name must be 2–40 characters.' }, origin);
      if (body.researcher !== undefined && typeof body.researcher !== 'boolean')
        return response(400, { error: 'Invalid researcher selection.' }, origin);
      if (body.admin !== undefined && typeof body.admin !== 'boolean')
        return response(400, { error: 'Invalid admin selection.' }, origin);

      const userMetadata: Record<string, string> = {};
      if (username) userMetadata.username = username;
      if (displayName) userMetadata.display_name = displayName;
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: userMetadata,
      });
      if (error || !data.user)
        return response(400, { error: error?.message || 'Unable to provision account.' }, origin);

      if (body.researcher === true) {
        const { error: grantError } = await userClient.rpc('admin_set_researcher_access', {
          p_user_id: data.user.id,
          p_enabled: true,
        });
        if (grantError)
          return response(
            500,
            { error: 'Account created, but researcher access could not be granted.' },
            origin,
          );
      }
      if (body.admin === true) {
        const { error: grantError } = await userClient.rpc('admin_set_admin_access', {
          p_user_id: data.user.id,
          p_enabled: true,
        });
        if (grantError)
          return response(
            500,
            { error: 'Account created, but admin access could not be granted.' },
            origin,
          );
      }
      return response(
        201,
        { user: { id: data.user.id, email: data.user.email, createdAt: data.user.created_at } },
        origin,
      );
    } catch (error) {
      return response(
        400,
        { error: error instanceof Error ? error.message : 'Invalid account details.' },
        origin,
      );
    }
  }

  if (body.action === 'set-banned') {
    if (typeof body.userId !== 'string' || typeof body.banned !== 'boolean')
      return response(400, { error: 'Invalid account status request.' }, origin);
    if (body.banned) {
      const { error } = await userClient.rpc('admin_assert_user_can_be_banned', {
        p_user_id: body.userId,
      });
      if (error) return response(400, { error: error.message }, origin);
    }
    const { data, error } = await adminClient.auth.admin.updateUserById(body.userId, {
      ban_duration: body.banned ? '876000h' : 'none',
    });
    if (error || !data.user)
      return response(400, { error: error?.message || 'Unable to update account status.' }, origin);
    return response(200, { user: { id: data.user.id, banned: body.banned } }, origin);
  }

  return response(400, { error: 'Unsupported admin action.' }, origin);
});
