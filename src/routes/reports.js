import { Router } from 'express';
import { findUserByTelegramId, supabase } from '../db.js';

const router = Router();

/**
 * GET /reports/weekly?telegram_id=&week_start=YYYY-MM-DD (optional)
 * Returns a stored weekly report row. If week_start is omitted, returns the latest report for the user.
 * Rows are created by the weekly cron job (see services/cron.js).
 */
router.get('/weekly', async (req, res) => {
  try {
    const telegramId = req.query.telegram_id;
    const weekStart = req.query.week_start;

    if (telegramId === undefined || telegramId === null || String(telegramId).trim() === '') {
      return res.status(400).json({ ok: false, error: 'telegram_id is required' });
    }

    const user = await findUserByTelegramId(telegramId);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found. Call POST /users/auth first.' });
    }

    if (weekStart) {
      const { data, error } = await supabase
        .from('weekly_reports')
        .select('id, user_id, week_start, summary, body, created_at')
        .eq('user_id', user.id)
        .eq('week_start', String(weekStart))
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return res.status(404).json({
          ok: false,
          error: 'No report for the requested week yet.',
        });
      }
      return res.status(200).json({ ok: true, report: data });
    }

    const { data, error } = await supabase
      .from('weekly_reports')
      .select('id, user_id, week_start, summary, body, created_at')
      .eq('user_id', user.id)
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({
        ok: false,
        error: 'No weekly reports yet. Wait for the scheduled job or insert a row manually.',
      });
    }

    return res.status(200).json({ ok: true, report: data });
  } catch (err) {
    console.error('[reports weekly GET]', err);
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
});

export default router;
