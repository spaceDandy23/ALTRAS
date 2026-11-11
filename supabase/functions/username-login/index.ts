import { createClient } from '@supabase/supabase-js';

const allowedOrigins = new Set(
  (Deno.env.get('ALTRAS_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const corsBase = {
  'Access-Control-Allow-Headers': 'apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function headers(origin: string | null) {
  return origin && allowedOrigins.has(origin)
    ? { ...corsBase, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : corsBase;
}

function reply(
  status: number,
  error: string | null,
  body: Record<string, unknown>,
  origin: string | null,
) {
  return Response.json(error ? { error } : body, { status, headers: headers(origin) });
}

async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin');
  if (origin && !allowedOrigins.has(origin)) return reply(403, 'Origin not allowed.', {}, null);
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: headers(origin) });
  if (request.method !== 'POST') return reply(405, 'Method not allowed.', {}, origin);

  const url = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const salt = Deno.env.get('LOGIN_RATE_LIMIT_SALT');
  if (!url || !publicKey || !serviceKey || !salt || allowedOrigins.size === 0)
    return reply(500, 'Server configuration is incomplete.', {}, origin);

  let credentials: { username: string; password: string };
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    credentials = {
      username: String((body as Record<string, unknown>).username ?? '')
        .trim()
        .toLowerCase(),
      password: String((body as Record<string, unknown>).password ?? ''),
    };
  } catch {
    return reply(400, 'Invalid request.', {}, origin);
  }
  const { username, password } = credentials;
  if (!/^[a-z0-9_-]{3,24}$/.test(username) || password.length < 1)
    return reply(401, 'Username or password is incorrect.', {}, origin);

  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const remoteAddress = forwarded || request.headers.get('cf-connecting-ip') || 'unknown';
  const usernameKey = await hash(`${salt}:username:${username}`);
  const addressKey = await hash(`${salt}:address:${remoteAddress}`);
  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const consume = (identifier: string, limit: number) =>
    service.rpc('consume_username_login_rate_limit', {
      p_identifier_hash: identifier,
      p_attempt_limit: limit,
      p_window_seconds: 900,
    });
  const [addressLimit, usernameLimit] = await Promise.all([
    consume(addressKey, 60),
    consume(usernameKey, 8),
  ]);
  if (addressLimit.error || usernameLimit.error)
    return reply(503, 'Sign in is temporarily unavailable.', {}, origin);
  if (addressLimit.data !== true || usernameLimit.data !== true)
    return reply(429, 'Too many sign-in attempts. Try again later.', {}, origin);

  const identity = await service.rpc('resolve_login_identity_for_edge', { p_username: username });
  if (identity.error || typeof identity.data !== 'string' || !identity.data)
    return reply(401, 'Username or password is incorrect.', {}, origin);

  const publicClient = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const signedIn = await publicClient.auth.signInWithPassword({ email: identity.data, password });
  if (signedIn.error || !signedIn.data.session)
    return reply(401, 'Username or password is incorrect.', {}, origin);

  await service.rpc('clear_username_login_rate_limit', { p_identifier_hash: usernameKey });
  return reply(
    200,
    null,
    {
      accessToken: signedIn.data.session.access_token,
      refreshToken: signedIn.data.session.refresh_token,
    },
    origin,
  );
});
