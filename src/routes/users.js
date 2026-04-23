import { Router } from 'express'
import supabase from '../services/supabase.js'

const router = Router()

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

  res.json(user)
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
