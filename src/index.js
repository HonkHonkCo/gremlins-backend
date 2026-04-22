import './env.js';
import express from 'express';
import cors from 'cors';

import usersRouter from './routes/users.js';
import gremlinsRouter from './routes/gremlins.js';
import entriesRouter from './routes/entries.js';
import reportsRouter from './routes/reports.js';
import { startWeeklyReportCron } from './services/cron.js';

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'gremlins-base-backend',
    hint: 'Корень без данных — откройте конкретный путь или используйте POST из PowerShell/Postman.',
    paths: {
      auth: 'POST /users/auth  body: { telegram_id, initData? }',
      gremlinsList: 'GET /gremlins?telegram_id=...',
      gremlinCreate: 'POST /gremlins  body: { telegram_id, name, notes? }',
      entryCreate: 'POST /entries  body: { telegram_id, gremlin_id, text }',
      reportWeekly: 'GET /reports/weekly?telegram_id=...',
    },
  });
});

app.use('/users', usersRouter);
app.use('/gremlins', gremlinsRouter);
app.use('/entries', entriesRouter);
app.use('/reports', reportsRouter);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`Gremlins Base API listening on http://localhost:${port}`);
  startWeeklyReportCron();
});
