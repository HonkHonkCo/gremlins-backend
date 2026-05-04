import { Router } from 'express'
import supabase from '../services/supabase.js'

const router = Router()

router.get('/', async (req, res) => {
  const { gremlin_id, limit = 50 } = req.query
  if (!gremlin_id) return res.status(400).json({ error: 'gremlin_id required' })
  const { data, error } = await supabase.from('meals').select('*').eq('gremlin_id', gremlin_id).order('date', { ascending: false }).order('created_at', { ascending: false }).limit(limit)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/', async (req, res) => {
  const { gremlin_id, name, meal_type, calories, protein, carbs, fat, weight_g, note, date } = req.body
  if (!gremlin_id || !name) return res.status(400).json({ error: 'gremlin_id and name required' })

  const { data: meal, error } = await supabase.from('meals')
    .insert({ gremlin_id, name, meal_type: meal_type || 'обед', calories, protein, carbs, fat, weight_g, note, date: date || new Date().toISOString().split('T')[0] })
    .select().single()
  if (error) return res.status(500).json({ error: error.message })

  const { data: gremlin } = await supabase.from('gremlins').select('stats').eq('id', gremlin_id).single()
  const stats = { ...(gremlin?.stats || {}) }
  stats.last_meal = name
  if (calories) stats.last_calories = calories
  if (protein) stats.last_protein = protein
  stats.total_meals = (stats.total_meals || 0) + 1
  stats.last_updated = new Date().toISOString().split('T')[0]

  await supabase.from('gremlins').update({ stats, updated_at: new Date().toISOString() }).eq('id', gremlin_id)
  res.json({ meal, stats })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params
  await supabase.from('meals').delete().eq('id', id)
  res.json({ success: true })
})

export default router
