import { Router } from 'express'
import supabase from '../services/supabase.js'
import { calcKBJU } from '../services/groq.js'

const router = Router()

// Пересчитывает stats повара из реальных данных за сегодня и неделю
async function recalcChefStats(gremlin_id) {
  const today = new Date().toISOString().split('T')[0]
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0]

  const { data: allMeals } = await supabase
    .from('meals').select('calories,protein,carbs,fat,date,name,meal_type')
    .eq('gremlin_id', gremlin_id)
    .gte('date', weekAgo)
    .order('date', { ascending: false })

  const meals = allMeals || []

  // Сегодня
  const todayMeals = meals.filter(m => m.date === today)
  const today_calories = Math.round(todayMeals.reduce((s, m) => s + (m.calories || 0), 0))
  const today_protein  = Math.round(todayMeals.reduce((s, m) => s + (m.protein  || 0), 0) * 10) / 10
  const today_carbs    = Math.round(todayMeals.reduce((s, m) => s + (m.carbs    || 0), 0) * 10) / 10
  const today_fat      = Math.round(todayMeals.reduce((s, m) => s + (m.fat      || 0), 0) * 10) / 10

  // Неделя — среднее в день
  const byDay = {}
  for (const m of meals) {
    if (!byDay[m.date]) byDay[m.date] = 0
    byDay[m.date] += m.calories || 0
  }
  const days = Object.values(byDay)
  const week_calories = days.length ? Math.round(days.reduce((s, v) => s + v, 0)) : 0
  const avg_day_calories = days.length ? Math.round(week_calories / days.length) : 0

  const { data: gremlin } = await supabase.from('gremlins').select('stats').eq('id', gremlin_id).single()
  const stats = { ...(gremlin?.stats || {}) }

  // Убираем старые мусорные поля
  delete stats.last_meal
  delete stats.total_meals

  stats.today_calories   = today_calories
  stats.today_protein    = today_protein
  stats.today_carbs      = today_carbs
  stats.today_fat        = today_fat
  stats.today_date       = today
  stats.week_calories    = week_calories
  stats.avg_day_calories = avg_day_calories
  // last_calories — последний приём для fallback
  if (meals[0]?.calories) stats.last_calories = meals[0].calories
  if (meals[0]?.protein)  stats.last_protein  = meals[0].protein
  stats.last_updated = today

  await supabase.from('gremlins').update({ stats, updated_at: new Date().toISOString() }).eq('id', gremlin_id)
  return stats
}

router.post('/calc-kbju', async (req, res) => {
  const { name, weight_g } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  try {
    const result = await calcKBJU(name, weight_g || null)
    res.json(result)
  } catch (e) {
    console.error('calcKBJU error:', e)
    res.status(500).json({ error: 'calc failed' })
  }
})

router.get('/', async (req, res) => {
  const { gremlin_id, limit = 50 } = req.query
  if (!gremlin_id) return res.status(400).json({ error: 'gremlin_id required' })
  const { data, error } = await supabase
    .from('meals').select('*').eq('gremlin_id', gremlin_id)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/', async (req, res) => {
  const { gremlin_id, name, meal_type, calories, protein, carbs, fat, weight_g, note, date } = req.body
  if (!gremlin_id || !name) return res.status(400).json({ error: 'gremlin_id and name required' })

  const { data: meal, error } = await supabase.from('meals')
    .insert({
      gremlin_id, name,
      meal_type: meal_type || 'обед',
      calories:  calories  || null,
      protein:   protein   || null,
      carbs:     carbs     || null,
      fat:       fat       || null,
      weight_g:  weight_g  || null,
      note:      note      || null,
      date:      date      || new Date().toISOString().split('T')[0],
    })
    .select().single()
  if (error) return res.status(500).json({ error: error.message })

  const stats = await recalcChefStats(gremlin_id)
  res.json({ meal, stats })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params
  const { data: meal } = await supabase.from('meals').select('gremlin_id').eq('id', id).single()
  await supabase.from('meals').delete().eq('id', id)

  if (meal?.gremlin_id) {
    const stats = await recalcChefStats(meal.gremlin_id)
    return res.json({ success: true, stats })
  }
  res.json({ success: true })
})

export default router
