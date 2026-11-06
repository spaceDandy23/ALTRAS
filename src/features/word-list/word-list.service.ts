import { z } from 'zod';
import { referenceEntrySchema, type ReferenceEntry } from '@/features/lessons/domain/content.schemas';
import { getSupabaseClient } from '@/services/supabase.client';

const entriesSchema = z.array(referenceEntrySchema);

export async function listMathWordEntries(): Promise<ReferenceEntry[]> {
  const { data, error } = await getSupabaseClient().rpc('get_math_word_list');
  if (error) throw new Error(error.message || 'Unable to load the Math Word List.');
  return entriesSchema.parse(data ?? []);
}

export async function saveMathWordEntries(entries: ReferenceEntry[]): Promise<ReferenceEntry[]> {
  const validated = entriesSchema.parse(entries);
  const { data, error } = await getSupabaseClient().rpc('save_math_word_list', { p_entries: validated });
  if (error) throw new Error(error.message || 'Unable to save the Math Word List.');
  return entriesSchema.parse(data ?? []);
}
