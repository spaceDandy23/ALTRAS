import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const isTestEnvironment = import.meta.env.MODE === 'test';

export const isSupabaseConfigured = Boolean(
  !isTestEnvironment && supabaseUrl && supabasePublishableKey,
);

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured || !supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      'Online services are not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
    );
  }

  client ??= createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'altras-auth',
    },
  });

  return client;
}

export function validateProductionConfiguration(): void {
  // Test mode may use local authentication fallback if Supabase is not configured
  if (isTestEnvironment) return;

  // Production deployments require Supabase configuration
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      'ALTRAS production deployments require Supabase configuration.\n' +
      'Missing environment variables:\n' +
      (supabaseUrl ? '' : '  • VITE_SUPABASE_URL\n') +
      (supabasePublishableKey ? '' : '  • VITE_SUPABASE_PUBLISHABLE_KEY\n') +
      'See docs/online-setup.md for setup instructions.',
    );
  }
}
