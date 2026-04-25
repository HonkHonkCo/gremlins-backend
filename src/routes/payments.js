import { Router } from 'express'
import supabase from '../services/supabase.js'

const router = Router()
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

// Создать invoice для Pro подписки
router.post('/invoice', async (req, res) => {
  const { telegram_id, user_id } = req.body
  if (!telegram_id || !user_id) {
    return res.status(400).json({ error: 'telegram_id and user_id required' })
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Personal Gremlins Pro',
        description: 'Up to 12 gremlins · Unlimited messages · Advanced stats',
        payload: JSON.stringify({ user_id, telegram_id, plan: 'pro' }),
        currency: 'XTR', // Telegram Stars
        prices: [{ label: 'Pro Plan (1 month)', amount: 200 }]
      })
    })

    const data = await response.json()
    if (!data.ok) {
      return res.status(500).json({ error: data.description })
    }

    res.json({ invoice_url: data.result })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Webhook для подтверждения оплаты от Telegram
router.post('/webhook', async (req, res) => {
  const update = req.body

  if (update.pre_checkout_query) {
    // Подтверждаем pre-checkout
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pre_checkout_query_id: update.pre_checkout_query.id,
        ok: true
      })
    })
    return res.json({ ok: true })
  }

  if (update.message?.successful_payment) {
    const payment = update.message.successful_payment
    const payload = JSON.parse(payment.invoice_payload)

    // Апгрейдим юзера до Pro
    await supabase
      .from('users')
      .update({ plan: 'pro' })
      .eq('id', payload.user_id)

    // Отправляем сообщение об успехе
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: update.message.chat.id,
        text: '⭐ Pro активирован! Теперь у тебя 12 гремлинов и безлимитные сообщения. Открой приложение!'
      })
    })

    return res.json({ ok: true })
  }

  res.json({ ok: true })
})

export default router
