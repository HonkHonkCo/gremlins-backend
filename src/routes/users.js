import { Router } from 'express'
import supabase from '../services/supabase.js'

const router = Router()

const FREE_GREMLINS = 3
const FREE_MESSAGES = 20
const PRO_GREMLINS = 12

router.post('/sync', async (req, res) => {
  const { telegram_id, username } = req.body
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' })

  let { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegram_id)
    .single()

  if (error && error.code !== 'PGRST116') {
    return res.status(500).json({ error: error.message })
  }

  if (!user) {
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({ telegram_id, username })
      .select()
      .single()
    if (createError) return res.status(500).json({ error: createError.message })
    user = newUser
  }

  // Сбрасываем счётчик если новый день
  const today = new Date().toISOString().split('T')[0]
  if (user.messages_date !== today) {
    const { data: updated } = await supabase
      .from('users')
      .update({ messages_today: 0, messages_date: today })
      .eq('id', user.id)
      .select()
      .single()
    if (updated) user = updated
  }

  res.json({
    ...user,
    limits: {
      max_gremlins: user.plan === 'pro' ? PRO_GREMLINS : FREE_GREMLINS,
      max_messages: user.plan === 'pro' ? null : FREE_MESSAGES,
      messages_used: user.messages_today || 0,
    }
  })
})

router.get('/:telegram_id', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', req.params.telegram_id)
    .single()

  if (error) return res.status(404).json({ error: 'User not found' })
  res.json(data)
})

export default router
