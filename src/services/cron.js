import cron from 'node-cron';
import { supabase } from '../db.js';
import { generateWeeklyReport } from './groq.js';

function mondayOfWeekContaining(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function addDaysIsoDate(isoDate, days) {
  const [y, m, dd] = isoDate.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, dd));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds the [weekStart, weekEnd) window in UTC dates (weekStart inclusive Monday).
 * @param {Date} reference
 */
function previousWeekWindow(reference) {
  const thisMonday = mondayOfWeekContaining(reference);
  const prevMonday = addDaysIsoDate(thisMonday, -7);
  const thisMondayExclusiveEnd = thisMonday;
  return { weekStart: prevMonday, weekEndExclusive: thisMondayExclusiveEnd };
}

async function loadEntriesForUserInRange(userId, weekStart, weekEndExclusive) {
  const { data: entries, error: e1 } = await supabase
    .from('entries')
    .select('id, created_at, raw_text, parsed, gremlin_id')
    .eq('user_id', userId)
    .gte('created_at', `${weekStart}T00:00:00.000Z`)
    .lt('created_at', `${weekEndExclusive}T00:00:00.000Z`)
    .order('created_at', { ascending: true });

  if (e1) throw e1;
  if (!entries?.length) return [];

  const gremlinIds = [...new Set(entries.map((x) => x.gremlin_id).filter(Boolean))];
  let gremlinNameById = new Map();
  if (gremlinIds.length) {
    const { data: gremlins, error: e2 } = await supabase
      .from('gremlins')
      .select('id, name')
      .in('id', gremlinIds);
    if (e2) throw e2;
    gremlinNameById = new Map((gremlins ?? []).map((g) => [g.id, g.name]));
  }

  return entries.map((row) => ({
    created_at: row.created_at,
    raw_text: row.raw_text,
    parsed: row.parsed,
    gremlin_name: row.gremlin_id ? gremlinNameById.get(row.gremlin_id) ?? null : null,
  }));
}

async function upsertWeeklyReport(userId, weekStart, summary, body) {
  const { data, error } = await supabase
    .from('weekly_reports')
    .upsert(
      {
        user_id: userId,
        week_start: weekStart,
        summary,
        body,
      },
      { onConflict: 'user_id,week_start' }
    )
    .select('id, user_id, week_start, summary, body, created_at')
    .single();

  if (error) throw error;
  return data;
}

export async function runWeeklyReportsJob(referenceDate = new Date()) {
  const { weekStart, weekEndExclusive } = previousWeekWindow(referenceDate);

  const { data: users, error } = await supabase.from('users').select('id, telegram_id');
  if (error) throw error;

  const results = [];
  for (const user of users ?? []) {
    try {
      const entries = await loadEntriesForUserInRange(user.id, weekStart, weekEndExclusive);
      if (!entries.length) {
        results.push({ user_id: user.id, week_start: weekStart, status: 'skipped_empty' });
        continue;
      }

      const report = await generateWeeklyReport({
        userLabel: `telegram:${user.telegram_id}`,
        entries,
      });

      const stored = await upsertWeeklyReport(user.id, weekStart, report, report.raw_markdown ?? '');
      results.push({ user_id: user.id, week_start: weekStart, status: 'ok', report_id: stored.id });
    } catch (err) {
      results.push({
        user_id: user.id,
        week_start: weekStart,
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { weekStart, weekEndExclusive, results };
}

/**
 * Monday 09:00 server local time — adjust via CRON_WEEKLY_REPORT or change pattern in code later.
 */
export function startWeeklyReportCron() {
  const pattern = process.env.CRON_WEEKLY_REPORT ?? '0 9 * * 1';

  cron.schedule(pattern, async () => {
    try {
      const out = await runWeeklyReportsJob(new Date());
      console.log('[cron] weekly reports finished', {
        weekStart: out.weekStart,
        ok: out.results.filter((r) => r.status === 'ok').length,
        errors: out.results.filter((r) => r.status === 'error').length,
      });
    } catch (err) {
      console.error('[cron] weekly reports failed', err);
    }
  });

  console.log('[cron] weekly report scheduler started:', pattern);
}
