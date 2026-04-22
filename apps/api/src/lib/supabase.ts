// apps/api/src/lib/supabase.ts
// Supabase client — dùng service key cho backend (bypass RLS)

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─── Singleton pattern ────────────────────────────────────────────────────────
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment');
  }

  _client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
  });

  return _client;
}

// Shorthand
export const db = () => getSupabase();

// ─── Helper: throw on error ────────────────────────────────────────────────────
export async function dbQuery<T>(
  query: ReturnType<SupabaseClient['from']>
): Promise<T[]> {
  const { data, error } = await (query as any);
  if (error) throw new Error(`DB error: ${error.message}`);
  return (data ?? []) as T[];
}

export async function dbQueryOne<T>(
  query: ReturnType<SupabaseClient['from']>
): Promise<T | null> {
  const results = await dbQuery<T>(query);
  return results[0] ?? null;
}
