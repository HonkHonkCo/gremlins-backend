import './env.js';
import express from 'express';
import cors from 'cors';
import usersRouter from './routes/users.js';
import gremlinsRouter from './routes/gremlins.js';
import entriesRouter from './routes/entries.js';
import reportsRouter from './routes/reports.js';
import paymentsRouter from './routes/payments.js';
import transactionsRouter from './routes/transactions.js';
import workoutsRouter from './routes/workouts.js';
import mealsRouter from './routes/meals.js';
import tasksRouter from './routes/tasks.js';
import { startWeeklyReportCron } from './services/cron.js';
import './services/push.js';

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.status(200).json({ ok: true, service: 'gremlins-base-backend' });
});

app.use('/users', usersRouter);
app.use('/gremlins', gremlinsRouter);
app.use('/entries', entriesRouter);
app.use('/reports', reportsRouter);
app.use('/payments', paymentsRouter);
app.use('/transactions', transactionsRouter);
app.use('/workouts', workoutsRouter);
app.use('/meals', mealsRouter);
app.use('/tasks', tasksRouter);

app.use((req, res) => { res.status(404).json({ ok: false, error: 'Not found' }); });
app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`Gremlins Base API listening on http://localhost:${port}`);
  startWeeklyReportCron();
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const webhookUrl = process.env.WEBHOOK_URL;
  if (botToken && webhookUrl) {
    fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${webhookUrl}/payments/webhook` })
    }).then(r => r.json()).then(d => {
      console.log('[webhook]', d.ok ? 'set successfully' : d.description);
    }).catch(e => console.error('[webhook error]', e));
  }
});
