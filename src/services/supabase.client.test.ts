import { describe, expect, it } from 'vitest';
import { getSupabaseClient, isSupabaseConfigured } from './supabase.client';

describe('Supabase client configuration', () => {
  it('either creates the configured client or fails with a useful setup message', () => {
    if (isSupabaseConfigured) {
      expect(getSupabaseClient()).toBeDefined();
      return;
    }

    expect(() => getSupabaseClient()).toThrow('Online services are not configured');
  });
});
