import cron from 'node-cron'
import supabase from './supabase.js'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

async function sendTelegramMessage(telegram_id, text) {
  if (!BOT_TOKEN || !telegram_id) return
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegram_id,
        text,
        parse_mode: 'HTML'
      })
    })
  } catch (err) {
    console.error('Telegram push error:', err.message)
  }
}

// Утреннее напоминание тренеру — каждый день в 09:00
cron.schedule('0 9 * * *', async () => {
  console.log('[PUSH] Morning trainer reminders...')
  try {
    const { data: trainers } = await supabase
      .from('gremlins')
      .select('id, name, stats, user_id, users(telegram_id)')
      .eq('role', 'trainer')

    for (const g of trainers || []) {
      const telegram_id = g.users?.telegram_id
      if (!telegram_id) continue

      const stats = g.stats || {}
      const lastUpdated = stats.last_updated
      const today = new Date().toISOString().split('T')[0]
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

      // Если вчера не было активности — напоминаем
      if (lastUpdated !== today && lastUpdated !== yesterday) {
        const lastWorkout = stats.last_workout || 'тренировки'
        await sendTelegramMessage(
          telegram_id,
          `🏋️ <b>${g.name}</b> напоминает:\n\nДавно не было активности! Последнее: ${lastWorkout}.\n\nНе забудь про тренировку сегодня 💪`
        )
      }
    }
  } catch (err) {
    console.error('[PUSH] Trainer cron error:', err.message)
  }
}, { timezone: 'Asia/Bangkok' })

// Напоминание секретаря о дедлайнах — каждый день в 10:00
cron.schedule('0 10 * * *', async () => {
  console.log('[PUSH] Secretary deadline reminders...')
  try {
    const { data: secretaries } = await supabase
      .from('gremlins')
      .select('id, name, stats, user_id, users(telegram_id)')
      .eq('role', 'secretary')

    const today = new Date().toISOString().split('T')[0]
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

    for (const g of secretaries || []) {
      const telegram_id = g.users?.telegram_id
      if (!telegram_id) continue

      const stats = g.stats || {}
      const deadline = stats.next_deadline
      const lastTask = stats.last_task
      const pendingTasks = stats.pending_tasks || 0

      if (!deadline && !pendingTasks) continue

      // Если дедлайн сегодня или завтра
      if (deadline === today) {
        await sendTelegramMessage(
          telegram_id,
          `📋 <b>${g.name}</b> срочно:\n\n⚠️ Сегодня дедлайн!\nЗадача: ${lastTask || 'не указана'}\n\nНе забудь выполнить! ⏰`
        )
      } else if (deadline === tomorrow) {
        await sendTelegramMessage(
          telegram_id,
          `📋 <b>${g.name}</b> напоминает:\n\n📅 Завтра дедлайн!\nЗадача: ${lastTask || 'не указана'}\n\nОсталось меньше суток 🕐`
        )
      } else if (pendingTasks > 0 && !deadline) {
        // Раз в неделю — напоминаем про задачи без дедлайна
        const dayOfWeek = new Date().getDay()
        if (dayOfWeek === 1) { // Понедельник
          await sendTelegramMessage(
            telegram_id,
            `📋 <b>${g.name}</b> напоминает:\n\nУ тебя ${pendingTasks} задач(и) в очереди.\nПоследняя: ${lastTask || '—'}\n\nКак дела с задачами? 📝`
          )
        }
      }
    }
  } catch (err) {
    console.error('[PUSH] Secretary cron error:', err.message)
  }
}, { timezone: 'Asia/Bangkok' })

// Вечерний отчёт бухгалтера — каждую пятницу в 19:00
cron.schedule('0 19 * * 5', async () => {
  console.log('[PUSH] Accountant weekly summary...')
  try {
    const { data: accountants } = await supabase
      .from('gremlins')
      .select('id, name, stats, user_id, users(telegram_id)')
      .eq('role', 'accountant')

    for (const g of accountants || []) {
      const telegram_id = g.users?.telegram_id
      if (!telegram_id) continue

      const stats = g.stats || {}
      const expThb = stats.expense_thb || 0
      const incThb = stats.income_thb || 0
      const balThb = stats.balance_thb || 0

      if (expThb === 0 && incThb === 0) continue

      const balSign = balThb >= 0 ? '+' : ''
      await sendTelegramMessage(
        telegram_id,
        `🧮 <b>${g.name}</b> — итог недели:\n\n` +
        `💸 Расходы: ${expThb.toLocaleString()} ฿\n` +
        `💰 Доходы: ${incThb.toLocaleString()} ฿\n` +
        `📊 Баланс: ${balSign}${balThb.toLocaleString()} ฿\n\n` +
        `Хороших выходных! 🎉`
      )
    }
  } catch (err) {
    console.error('[PUSH] Accountant cron error:', err.message)
  }
}, { timezone: 'Asia/Bangkok' })

console.log('[PUSH] Push notification crons registered')
