import { Router } from 'express'
import supabase from '../services/supabase.js'

const router = Router()

router.get('/', async (req, res) => {
  const { gremlin_id } = req.query
  if (!gremlin_id) return res.status(400).json({ error: 'gremlin_id required' })
  const { data, error } = await supabase.from('debts').select('*').eq('gremlin_id', gremlin_id).order('date', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/', async (req, res) => {
  const { gremlin_id, direction, person, amount, currency, note, date } = req.body
  if (!gremlin_id || !direction || !person || !amount || !currency)
    return res.status(400).json({ error: 'required fields missing' })
  const { data, error } = await supabase.from('debts')
    .insert({ gremlin_id, direction, person, amount, currency: currency.toUpperCase(), note, date: date || new Date().toISOString().split('T')[0] })
    .select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.patch('/:id', async (req, res) => {
  const { status } = req.body
  const { data, error } = await supabase.from('debts').update({ status }).eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.delete('/:id', async (req, res) => {
  await supabase.from('debts').delete().eq('id', req.params.id)
  res.json({ success: true })
})

export default router
