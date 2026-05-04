import { Router } from 'express'
import supabase from '../services/supabase.js'

const router = Router()

router.get('/', async (req, res) => {
  const { gremlin_id, limit = 50 } = req.query
  if (!gremlin_id) return res.status(400).json({ error: 'gremlin_id required' })
  const { data, error } = await supabase.from('workouts').select('*').eq('gremlin_id', gremlin_id).order('date', { ascending: false }).order('created_at', { ascending: false }).limit(limit)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/', async (req, res) => {
  const { gremlin_id, type, duration_min, distance_km, sets, reps, weight_kg, calories, note, date } = req.body
  if (!gremlin_id || !type) return res.status(400).json({ error: 'gremlin_id and type required' })

  const { data: workout, error } = await supabase.from('workouts')
    .insert({ gremlin_id, type, duration_min, distance_km, sets, reps, weight_kg, calories, note, date: date || new Date().toISOString().split('T')[0] })
    .select().single()
  if (error) return res.status(500).json({ error: error.message })

  // Обновляем stats
  const { data: gremlin } = await supabase.from('gremlins').select('stats').eq('id', gremlin_id).single()
  const stats = { ...(gremlin?.stats || {}) }
  stats.last_workout = type
  if (duration_min) stats.last_duration_min = duration_min
  if (distance_km) stats.last_distance_km = distance_km
  if (calories) stats.total_calories = (stats.total_calories || 0) + calories
  if (sets && reps) stats.last_pushups = sets * reps
  stats.total_workouts = (stats.total_workouts || 0) + 1
  stats.last_updated = new Date().toISOString().split('T')[0]

  await supabase.from('gremlins').update({ stats, updated_at: new Date().toISOString() }).eq('id', gremlin_id)
  res.json({ workout, stats })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params
  await supabase.from('workouts').delete().eq('id', id)
  res.json({ success: true })
})

export default router
