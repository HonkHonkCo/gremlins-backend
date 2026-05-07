import { Router } from 'express'
import supabase from '../services/supabase.js'

const router = Router()

router.get('/', async (req, res) => {
  const { gremlin_id } = req.query
  if (!gremlin_id) return res.status(400).json({ error: 'gremlin_id required' })
  const { data, error } = await supabase.from('accounts').select('*').eq('gremlin_id', gremlin_id).order('created_at')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/', async (req, res) => {
  const { gremlin_id, name, currency, type, balance } = req.body
  if (!gremlin_id || !name || !currency) return res.status(400).json({ error: 'required: gremlin_id, name, currency' })
  const { data, error } = await supabase.from('accounts')
    .insert({ gremlin_id, name, currency: currency.toUpperCase(), type: type || 'cash', balance: balance || 0 })
    .select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.patch('/:id', async (req, res) => {
  const { name, balance } = req.body
  const updates = {}
  if (name !== undefined) updates.name = name
  if (balance !== undefined) updates.balance = balance
  const { data, error } = await supabase.from('accounts').update(updates).eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.delete('/:id', async (req, res) => {
  await supabase.from('accounts').delete().eq('id', req.params.id)
  res.json({ success: true })
})

export default router
