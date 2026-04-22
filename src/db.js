import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables.'
  );
}

/**
 * Supabase client with the service role key (bypasses RLS). Use only on the server.
 * Expected tables (create in Supabase SQL editor as needed):
 *
 * users: id uuid pk default gen_random_uuid(), telegram_id text unique not null,
 *   init_data_last text, created_at timestamptz default now()
 * gremlins: id uuid pk default gen_random_uuid(), user_id uuid references users(id) on delete cascade,
 *   name text not null, notes text, created_at timestamptz default now(), updated_at timestamptz default now()
 * entries: id uuid pk default gen_random_uuid(), user_id uuid references users(id) on delete cascade,
 *   gremlin_id uuid references gremlins(id) on delete cascade, raw_text text not null,
 *   parsed jsonb, created_at timestamptz default now()
 * weekly_reports: id uuid pk default gen_random_uuid(), user_id uuid references users(id) on delete cascade,
 *   week_start date not null, summary jsonb not null, body text, created_at timestamptz default now(),
 *   unique(user_id, week_start)
 */
export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/**
 * @param {string} telegramId
 */
export async function findUserByTelegramId(telegramId) {
  const tid = String(telegramId).trim();
  const { data, error } = await supabase
    .from('users')
    .select('id, telegram_id, created_at')
    .eq('telegram_id', tid)
    .maybeSingle();

  if (error) throw error;
  return data;
}
