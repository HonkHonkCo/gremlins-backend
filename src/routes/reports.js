import { Router } from 'express';
import { findUserByTelegramId, supabase } from '../db.js';

const router = Router();

/**
 * GET /reports/weekly?telegram_id=&all=true
 * Returns all stored weekly reports for a user (newest first).
 * If all is omitted, returns only the latest one.
 */
router.get('/weekly', async (req, res) => {
  try {
    const telegramId = req.query.telegram_id;
    const returnAll = req.query.all === 'true';

    if (!telegramId || String(telegramId).trim() === '') {
      return res.status(400).json({ ok: false, error: 'telegram_id is required' });
    }

    const user = await findUserByTelegramId(telegramId);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found.' });
    }

    let query = supabase
      .from('weekly_reports')
      .select('id, user_id, week_start, summary, body, all_stats, created_at')
      .eq('user_id', user.id)
      .order('week_start', { ascending: false });

    if (!returnAll) query = query.limit(1);

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'No weekly reports yet.',
      });
    }

    // Если запросили один — возвращаем в старом формате для совместимости
    if (!returnAll) {
      return res.status(200).json({ ok: true, report: data[0] });
    }

    return res.status(200).json({ ok: true, reports: data });
  } catch (err) {
    console.error('[reports weekly GET]', err);
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

export default router;
