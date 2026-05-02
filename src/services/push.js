import cron from 'node-cron'
import supabase from './supabase.js'
import { generateGremlinAdvice } from './groq.js'

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
    console.error('[PUSH] Telegram error:', err.message)
  }
}

// Утреннее напоминание тренера — каждый день 09:00
cron.schedule('0 9 * * *', async () => {
  console.log('[PUSH] Morning trainer reminders...')
  try {
    const { data: trainers } = await supabase
      .from('gremlins')
      .select('id, name, role, stats, users(telegram_id)')
      .eq('role', 'trainer')

    for (const g of trainers || []) {
      const telegram_id = g.users?.telegram_id
      if (!telegram_id) continue
      const stats = g.stats || {}
      const today = new Date().toISOString().split('T')[0]
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
      if (stats.last_updated === today || stats.last_updated === yesterday) continue

      const advice = await generateGremlinAdvice(g)
      await sendTelegramMessage(telegram_id,
        '🏋️ <b>' + g.name + '</b>:\n\n' + advice
      )
    }
  } catch (err) {
    console.error('[PUSH] Trainer cron error:', err.message)
  }
}, { timezone: 'Asia/Bangkok' })

// Напоминание секретаря о дедлайнах — каждый день 10:00
cron.schedule('0 10 * * *', async () => {
  console.log('[PUSH] Secretary deadline reminders...')
  try {
    const { data: secretaries } = await supabase
      .from('gremlins')
      .select('id, name, role, stats, users(telegram_id)')
      .eq('role', 'secretary')

    const today = new Date().toISOString().split('T')[0]
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

    for (const g of secretaries || []) {
      const telegram_id = g.users?.telegram_id
      if (!telegram_id) continue
      const stats = g.stats || {}
      const deadline = stats.next_deadline
      if (!deadline && !stats.pending_tasks) continue

      let urgent = false
      if (deadline === today || deadline === tomorrow) urgent = true
      if (!urgent && new Date().getDay() !== 1) continue // не срочно — только по понедельникам

      const advice = await generateGremlinAdvice(g)
      await sendTelegramMessage(telegram_id,
        '📋 <b>' + g.name + '</b>:\n\n' + advice
      )
    }
  } catch (err) {
    console.error('[PUSH] Secretary cron error:', err.message)
  }
}, { timezone: 'Asia/Bangkok' })

// Пятничный итог бухгалтера с AI советом — 19:00
cron.schedule('0 19 * * 5', async () => {
  console.log('[PUSH] Accountant weekly summary...')
  try {
    const { data: accountants } = await supabase
      .from('gremlins')
      .select('id, name, role, stats, users(telegram_id)')
      .eq('role', 'accountant')

    for (const g of accountants || []) {
      const telegram_id = g.users?.telegram_id
      if (!telegram_id) continue
      const stats = g.stats || {}

      // Собираем строки по валютам
      const currencyLines = []
      const keys = Object.keys(stats)
      const currencies = [...new Set(
        keys
          .filter(k => k.startsWith('expense_') || k.startsWith('income_'))
          .map(k => k.split('_').slice(1).join('_').toUpperCase())
      )]

      for (const cur of currencies) {
        const exp = stats['expense_' + cur.toLowerCase()] || 0
        const inc = stats['income_' + cur.toLowerCase()] || 0
        const bal = stats['balance_' + cur.toLowerCase()] || 0
        if (exp === 0 && inc === 0) continue
        currencyLines.push('  ' + cur + ': расход ' + exp.toLocaleString('ru-RU') + ' / доход ' + inc.toLocaleString('ru-RU') + ' / баланс ' + (bal >= 0 ? '+' : '') + bal.toLocaleString('ru-RU'))
      }

      if (currencyLines.length === 0) continue

      const advice = await generateGremlinAdvice(g)

      await sendTelegramMessage(telegram_id,
        '🧮 <b>' + g.name + '</b> — итог недели:\n\n' +
        currencyLines.join('\n') +
        '\n\n' + advice
      )
    }
  } catch (err) {
    console.error('[PUSH] Accountant cron error:', err.message)
  }
}, { timezone: 'Asia/Bangkok' })

console.log('[PUSH] Push notification crons registered')
