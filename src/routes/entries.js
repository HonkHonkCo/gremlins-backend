import { Router } from 'express'
import supabase from '../services/supabase.js'
import { chatWithGremlin, parseEntry } from '../services/groq.js'

const router = Router()

router.get('/', async (req, res) => {
  const { gremlin_id, limit = 30 } = req.query
  if (!gremlin_id) return res.status(400).json({ error: 'gremlin_id required' })

  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('gremlin_id', gremlin_id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/chat', async (req, res) => {
  const { gremlin_id, content } = req.body
  if (!gremlin_id || !content) {
    return res.status(400).json({ error: 'gremlin_id and content required' })
  }

  const { data: gremlin, error: gremlinError } = await supabase
    .from('gremlins')
    .select('*')
    .eq('id', gremlin_id)
    .single()

  if (gremlinError) return res.status(404).json({ error: 'Gremlin not found' })

  const { data: recentEntries } = await supabase
    .from('entries')
    .select('content, entry_date')
    .eq('gremlin_id', gremlin_id)
    .order('entry_date', { ascending: false })
    .limit(20)

  const [parsed, reply] = await Promise.all([
    parseEntry(gremlin.role, content),
    chatWithGremlin(gremlin, content, recentEntries || [])
  ])

  const { data: entry, error: entryError } = await supabase
    .from('entries')
    .insert({ gremlin_id, content, parsed_data: parsed })
    .select()
    .single()

  if (entryError) return res.status(500).json({ error: entryError.message })

  if (parsed && Object.keys(parsed).length > 0) {
    const updatedStats = mergeStats(gremlin.stats || {}, parsed, gremlin.role)
    await supabase.from('gremlins').update({ stats: updatedStats }).eq('id', gremlin_id)
  }

  res.json({ entry, reply })
})

function mergeStats(current, parsed, role) {
  const stats = { ...current }

  if (role === 'accountant') {
    // Новый умный формат с валютами
    if (parsed.totals) {
      const t = parsed.totals
      stats.expense_thb = (stats.expense_thb || 0) + (t.expense_thb || 0)
      stats.expense_rub = (stats.expense_rub || 0) + (t.expense_rub || 0)
      stats.expense_usd = (stats.expense_usd || 0) + (t.expense_usd || 0)
      stats.income_thb = (stats.income_thb || 0) + (t.income_thb || 0)
      stats.income_rub = (stats.income_rub || 0) + (t.income_rub || 0)
      stats.income_usd = (stats.income_usd || 0) + (t.income_usd || 0)
      stats.investment_rub = (stats.investment_rub || 0) + (t.investment_rub || 0)
      stats.investment_usd = (stats.investment_usd || 0) + (t.investment_usd || 0)
      // Остаток по каждой валюте
      stats.balance_thb = (stats.income_thb || 0) - (stats.expense_thb || 0)
      stats.balance_rub = (stats.income_rub || 0) - (stats.expense_rub || 0)
      stats.balance_usd = (stats.income_usd || 0) - (stats.expense_usd || 0)
    } else if (parsed.total) {
      // Старый формат — для совместимости
      stats.today_total = (stats.today_total || 0) + parsed.total
      stats.week_total = (stats.week_total || 0) + parsed.total
    }
    stats.last_updated = new Date().toISOString().split('T')[0]
  }

  if (role === 'trainer') {
    if (parsed.calories) stats.last_calories = parsed.calories
    if (parsed.workout) stats.last_workout = parsed.workout
    if (parsed.water_liters) stats.last_water = parsed.water_liters
    if (parsed.weight_kg) stats.weight_kg = parsed.weight_kg
    if (parsed.steps) stats.steps = parsed.steps
  }

  if (role === 'secretary') {
    if (parsed.task) {
      stats.pending_tasks = (stats.pending_tasks || 0) + 1
      stats.last_task = parsed.task
      if (parsed.deadline) stats.next_deadline = parsed.deadline
    }
  }

  if (role === 'chef') {
    if (parsed.calories) stats.last_calories = parsed.calories
    if (parsed.meal) stats.last_meal = parsed.meal
    if (parsed.protein) stats.last_protein = parsed.protein
  }

  return stats
}

export default router
