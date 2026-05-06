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

function daysSince(dateStr) {
  if (!dateStr) return 9999
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

// Тренер — только по понедельникам и четвергам в 09:00 (не каждый день)
cron.schedule('0 9 * * 1,4', async () => {
  console.log('[PUSH] Trainer reminders...')
  try {
    const { data: trainers } = await supabase
      .from('gremlins')
      .select('id, name, role, stats, users(telegram_id)')
      .eq('role', 'trainer')

    for (const g of trainers || []) {
      const telegram_id = g.users?.telegram_id
      if (!telegram_id) continue
      const stats = g.stats || {}
      // Напоминаем только если 3+ дней без активности
      if (daysSince(stats.last_updated) < 3) continue

      const advice = await generateGremlinAdvice(g)
      // Короткое сообщение — только совет, без заголовка
      await sendTelegramMessage(telegram_id, '🏋️ ' + g.name + ':\n' + advice)
    }
  } catch (err) {
    console.error('[PUSH] Trainer error:', err.message)
  }
}, { timezone: 'Asia/Bangkok' })

// Секретарь — дедлайны, каждый день 10:00
cron.schedule('0 10 * * *', async () => {
  console.log('[PUSH] Secretary deadlines...')
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
      if (!deadline) continue
      if (deadline !== today && deadline !== tomorrow) continue

      const advice = await generateGremlinAdvice(g)
      await sendTelegramMessage(telegram_id, '📋 ' + g.name + ':\n' + advice)
    }
  } catch (err) {
    console.error('[PUSH] Secretary error:', err.message)
  }
}, { timezone: 'Asia/Bangkok' })

// Бухгалтер — пятница 19:00
cron.schedule('0 19 * * 5', async () => {
  console.log('[PUSH] Accountant weekly...')
  try {
    const { data: accountants } = await supabase
      .from('gremlins')
      .select('id, name, role, stats, users(telegram_id)')
      .eq('role', 'accountant')

    for (const g of accountants || []) {
      const telegram_id = g.users?.telegram_id
      if (!telegram_id) continue
      const stats = g.stats || {}

      const currencies = [...new Set(
        Object.keys(stats)
          .filter(k => k.startsWith('expense_') || k.startsWith('income_'))
          .map(k => k.split('_').slice(1).join('_').toUpperCase())
      )]
      if (currencies.length === 0) continue

      const lines = []
      for (const cur of currencies) {
        const exp = stats['expense_' + cur.toLowerCase()] || 0
        const inc = stats['income_' + cur.toLowerCase()] || 0
        const bal = stats['balance_' + cur.toLowerCase()] || 0
        if (exp === 0 && inc === 0) continue
        lines.push(cur + ': ' + (bal >= 0 ? '+' : '') + bal.toLocaleString('ru-RU'))
      }
      if (lines.length === 0) continue

      const advice = await generateGremlinAdvice(g)
      await sendTelegramMessage(telegram_id,
        '🧮 ' + g.name + ' — итог недели:\n' + lines.join(' | ') + '\n\n' + advice
      )
    }
  } catch (err) {
    console.error('[PUSH] Accountant error:', err.message)
  }
}, { timezone: 'Asia/Bangkok' })

// Уведомления о неактивности — каждый день в 12:00
// Логика: 3 дня → напомнить, 5 дней → второй раз, 14 дней → третий раз
cron.schedule('0 12 * * *', async () => {
  console.log('[PUSH] Inactivity check...')
  try {
    const { data: users } = await supabase
      .from('users')
      .select('id, telegram_id, username')
      .not('telegram_id', 'is', null)

    for (const user of users || []) {
      if (!user.telegram_id || user.telegram_id < 0) continue // пропускаем браузерных

      // Смотрим последнюю активность — последний entry или transaction
      const { data: lastEntry } = await supabase
        .from('entries')
        .select('created_at')
        .in('gremlin_id',
          supabase.from('gremlins').select('id').eq('user_id', user.id)
        )
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      const lastDate = lastEntry?.created_at
      const days = daysSince(lastDate)

      // Проверяем ключевые пороги
      const shouldNotify = days === 3 || days === 5 || days === 14
      if (!shouldNotify) continue

      // Берём первого гремлина для имени
      const { data: gremlins } = await supabase
        .from('gremlins').select('name, role').eq('user_id', user.id).limit(1)
      const gremlin = gremlins?.[0]

      let msg = ''
      if (days === 3) {
        const variants = [
          '👀 Эй, ты там живой? Твои гремлины скучают уже ' + days + ' дня...',
          '🧟 ' + (gremlin?.name || 'Гремлин') + ' зарос паутиной пока тебя нет.',
          '😤 ' + days + ' дня без данных. Гремлины бунтуют!',
        ]
        msg = variants[Math.floor(Math.random() * variants.length)]
      } else if (days === 5) {
        const variants = [
          '😴 5 дней тишины... ' + (gremlin?.name || 'Гремлин') + ' думает, что ты его бросил.',
          '🫗 Твоя статистика пустеет. Гремлины голодают без данных.',
          '⏰ 5 дней прошло. Неужели всё так хорошо, что нечего записывать?',
        ]
        msg = variants[Math.floor(Math.random() * variants.length)]
      } else if (days === 14) {
        const variants = [
          '🪦 2 недели... Гремлины уже написали завещание.',
          '🕸️ Две недели без тебя. ' + (gremlin?.name || 'Гремлин') + ' переквалифицировался в призрака.',
          '😭 14 дней! Гремлины устроили собственный еженедельный отчёт — там только грусть.',
        ]
        msg = variants[Math.floor(Math.random() * variants.length)]
      }

      if (msg) {
        await sendTelegramMessage(user.telegram_id, msg)
        console.log('[PUSH] Inactivity ' + days + 'd → user', user.telegram_id)
      }
    }
  } catch (err) {
    console.error('[PUSH] Inactivity error:', err.message)
  }
}, { timezone: 'Asia/Bangkok' })

console.log('[PUSH] Push notification crons registered')
