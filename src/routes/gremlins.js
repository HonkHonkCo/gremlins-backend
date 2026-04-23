import { Router } from 'express'
import supabase from '../services/supabase.js'

const router = Router()

router.get('/', async (req, res) => {
  const { user_id } = req.query
  if (!user_id) return res.status(400).json({ error: 'user_id required' })

  const { data, error } = await supabase
    .from('gremlins')
    .select('*')
    .eq('user_id', user_id)
    .order('updated_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/', async (req, res) => {
  const { user_id, role, name, description } = req.body
  if (!user_id || !role || !name) {
    return res.status(400).json({ error: 'user_id, role, name required' })
  }

  const { data, error } = await supabase
    .from('gremlins')
    .insert({ user_id, role, name, description })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.patch('/:id', async (req, res) => {
  const { name, description } = req.body
  const { data, error } = await supabase
    .from('gremlins')
    .update({ name, description })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('gremlins').delete().eq('id', req.params.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

export default router
