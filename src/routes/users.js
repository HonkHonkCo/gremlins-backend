const express = require('express')
const router = express.Router()
const supabase = require('../services/supabase')

// Получить или создать юзера по telegram_id
router.post('/sync', async (req, res) => {
  const { telegram_id, username } = req.body

  if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' })

  // Ищем существующего
  let { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegram_id)
    .single()

  if (error && error.code !== 'PGRST116') {
    return res.status(500).json({ error: error.message })
  }

  // Создаём если нет
  if (!user) {
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({ telegram_id, username })
      .select()
      .single()

    if (createError) return res.status(500).json({ error: createError.message })
    user = newUser
  }

  res.json(user)
})

// Получить юзера
router.get('/:telegram_id', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', req.params.telegram_id)
    .single()

  if (error) return res.status(404).json({ error: 'User not found' })
  res.json(data)
})

module.exports = router
