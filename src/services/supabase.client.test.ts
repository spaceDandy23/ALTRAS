import { describe, expect, it } from 'vitest';
import { getSupabaseClient } from './supabase.client';

describe('Supabase client configuration', () => {
  it('fails with a useful setup message when unit tests have no configured client', () => {
    expect(() => getSupabaseClient()).toThrow('Online services are not configured');
  });
});
