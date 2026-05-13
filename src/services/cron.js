import cron from 'node-cron';
import { supabase } from '../db.js';
import { generateWeeklyReport } from './groq.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

async function sendTelegramMessage(telegram_id, text) {
  if (!BOT_TOKEN || !telegram_id) return
  try {
    await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegram_id, text, parse_mode: 'HTML' })
    })
  } catch (err) {
    console.error('[CRON] Telegram error:', err.message)
  }
}

function mondayOfWeekContaining(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function addDaysIsoDate(isoDate, days) {
  const [y, m, dd] = isoDate.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, dd));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function previousWeekWindow(reference) {
  const thisMonday = mondayOfWeekContaining(reference);
  const prevMonday = addDaysIsoDate(thisMonday, -7);
  return { weekStart: prevMonday, weekEndExclusive: thisMonday };
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

  const gremlinIds = [...new Set(entries.map(x => x.gremlin_id).filter(Boolean))];
  let gremlinNameById = new Map();
  if (gremlinIds.length) {
    const { data: gremlins } = await supabase
      .from('gremlins').select('id, name').in('id', gremlinIds);
    gremlinNameById = new Map((gremlins ?? []).map(g => [g.id, g.name]));
  }

  return entries.map(row => ({
    created_at: row.created_at,
    raw_text: row.raw_text,
    parsed: row.parsed,
    gremlin_name: row.gremlin_id ? gremlinNameById.get(row.gremlin_id) ?? null : null,
  }));
}

// Собираем агрегированную статистику по всем гремлинам пользователя за неделю
async function loadWeeklyStats(userId, weekStart, weekEndExclusive) {
  const stats = {}

  // Транзакции за неделю
  const { data: txs } = await supabase
    .from('transactions')
    .select('type, amount, currency')
    .in('gremlin_id', supabase.from('gremlins').select('id').eq('user_id', userId))
    .gte('date', weekStart)
    .lt('date', weekEndExclusive)

  for (const tx of txs || []) {
    const key = `${tx.type}_${tx.currency?.toLowerCase()}`
    stats[key] = Math.round(((stats[key] || 0) + (tx.amount || 0)) * 100) / 100
  }

  // Тренировки за неделю
  const { data: workouts } = await supabase
    .from('workouts')
    .select('type, duration_min, calories')
    .in('gremlin_id', supabase.from('gremlins').select('id').eq('user_id', userId))
    .gte('date', weekStart)
    .lt('date', weekEndExclusive)

  if (workouts?.length) {
    stats.workouts_count = workouts.length
    stats.workouts_minutes = workouts.reduce((s, w) => s + (w.duration_min || 0), 0)
    stats.workouts_calories = workouts.reduce((s, w) => s + (w.calories || 0), 0)
    stats.workout_types = [...new Set(workouts.map(w => w.type).filter(Boolean))].join(', ')
  }

  // Питание за неделю
  const { data: meals } = await supabase
    .from('meals')
    .select('calories, protein, carbs, fat')
    .in('gremlin_id', supabase.from('gremlins').select('id').eq('user_id', userId))
    .gte('date', weekStart)
    .lt('date', weekEndExclusive)

  if (meals?.length) {
    stats.meals_count = meals.length
    stats.avg_calories = Math.round(meals.reduce((s, m) => s + (m.calories || 0), 0) / meals.length)
    stats.avg_protein = Math.round(meals.reduce((s, m) => s + (m.protein || 0), 0) / meals.length)
  }

  // Задачи закрытые за неделю
  const { data: tasks } = await supabase
    .from('tasks')
    .select('status, priority')
    .in('gremlin_id', supabase.from('gremlins').select('id').eq('user_id', userId))
    .eq('status', 'done')
    .gte('updated_at', `${weekStart}T00:00:00.000Z`)
    .lt('updated_at', `${weekEndExclusive}T00:00:00.000Z`)

  if (tasks?.length) {
    stats.tasks_done = tasks.length
    stats.tasks_high = tasks.filter(t => t.priority === 'high').length
  }

  return stats
}

async function upsertWeeklyReport(userId, weekStart, summary, body, all_stats) {
  const { data, error } = await supabase
    .from('weekly_reports')
    .upsert(
      { user_id: userId, week_start: weekStart, summary, body, all_stats },
      { onConflict: 'user_id,week_start' }
    )
    .select('id, user_id, week_start, summary, body, all_stats, created_at')
    .single();

  if (error) throw error;
  return data;
}

export async function runWeeklyReportsJob(referenceDate = new Date()) {
  const { weekStart, weekEndExclusive } = previousWeekWindow(referenceDate);

  const { data: users, error } = await supabase
    .from('users').select('id, telegram_id');
  if (error) throw error;

  const results = [];
  for (const user of users ?? []) {
    try {
      const entries = await loadEntriesForUserInRange(user.id, weekStart, weekEndExclusive);

      // Пропускаем только если вообще ноль активности
      if (!entries.length) {
        results.push({ user_id: user.id, week_start: weekStart, status: 'skipped_empty' });
        continue;
      }

      // Собираем числовую статистику параллельно с генерацией текста
      const [report, all_stats] = await Promise.all([
        generateWeeklyReport({ userLabel: `telegram:${user.telegram_id}`, entries }),
        loadWeeklyStats(user.id, weekStart, weekEndExclusive),
      ]);

      const stored = await upsertWeeklyReport(user.id, weekStart, report, '', all_stats);

      // Push-уведомление в Telegram
      if (user.telegram_id && user.telegram_id > 0) {
        const statsLines = []
        const cur = Object.keys(all_stats).find(k => k.startsWith('expense_'))?.split('_')[1]?.toUpperCase()
        if (cur) {
          const exp = all_stats[`expense_${cur.toLowerCase()}`]
          const inc = all_stats[`income_${cur.toLowerCase()}`]
          if (exp) statsLines.push(`💸 Расходы: ${exp.toLocaleString('ru-RU')} ${cur}`)
          if (inc) statsLines.push(`💰 Доходы: ${inc.toLocaleString('ru-RU')} ${cur}`)
        }
        if (all_stats.workouts_count) statsLines.push(`🏋️ Тренировок: ${all_stats.workouts_count} (${all_stats.workouts_minutes} мин)`)
        if (all_stats.tasks_done) statsLines.push(`✅ Задач закрыто: ${all_stats.tasks_done}`)
        if (all_stats.avg_calories) statsLines.push(`🍽 Ср. калорий/приём: ${all_stats.avg_calories} ккал`)

        const msg = `📊 <b>Недельный отчёт гремлинов</b>\n${weekStart} — ${addDaysIsoDate(weekStart, 6)}\n\n${statsLines.join('\n')}${statsLines.length ? '\n\n' : ''}${report}`
        await sendTelegramMessage(user.telegram_id, msg.slice(0, 4000))
      }

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

// Понедельник 09:00 по Bangkok (UTC+7)
export function startWeeklyReportCron() {
  const pattern = process.env.CRON_WEEKLY_REPORT ?? '0 9 * * 1';

  cron.schedule(pattern, async () => {
    try {
      const out = await runWeeklyReportsJob(new Date());
      console.log('[cron] weekly reports finished', {
        weekStart: out.weekStart,
        ok: out.results.filter(r => r.status === 'ok').length,
        skipped: out.results.filter(r => r.status === 'skipped_empty').length,
        errors: out.results.filter(r => r.status === 'error').length,
      });
    } catch (err) {
      console.error('[cron] weekly reports failed', err);
    }
  }, { timezone: 'Asia/Bangkok' });

  console.log('[cron] weekly report scheduler started:', pattern);
}
