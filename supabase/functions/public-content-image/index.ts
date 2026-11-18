import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const bucket = 'public-content-assets';
const permittedPaths = ['understandImagePath', 'applyImagePath', 'reflectImagePath'] as const;

Deno.serve(async (request) => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const path = new URL(request.url).searchParams.get('path');
  if (!path?.startsWith('landing/')) return new Response('Not found', { status: 404 });

  const publicClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  );
  const client = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  const { data: result, error } = await publicClient.rpc('get_public_content', { p_page_key: 'landing' });
  const published = result && typeof result === 'object'
    ? (result as { content?: unknown }).content
    : null;
  if (error || !published || typeof published !== 'object') {
    return new Response('Not found', { status: 404 });
  }

  if (!permittedPaths.some((key) => (published as Record<string, unknown>)[key] === path)) {
    return new Response('Not found', { status: 404 });
  }

  const { data, error: signedUrlError } = await client.storage.from(bucket).createSignedUrl(path, 60);
  if (signedUrlError || !data?.signedUrl) return new Response('Not found', { status: 404 });

  return Response.redirect(data.signedUrl, 302);
});
