const express = require('express')
const router = express.Router()
const supabase = require('../services/supabase')
const { chatWithGremlin, parseEntry } = require('../services/groq')

// Получить записи гремлина
router.get('/', async (req, res) => {
  const { gremlin_id, limit = 30 } = req.query
  if (!gremlin_id) return res.status(400).json({ error: 'gremlin_id required' })

  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('gremlin_id', gremlin_id)
    .order('entry_date', { ascending: false })
    .limit(limit)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// Добавить запись + получить ответ гремлина
router.post('/chat', async (req, res) => {
  const { gremlin_id, content } = req.body
  if (!gremlin_id || !content) {
    return res.status(400).json({ error: 'gremlin_id and content required' })
  }

  // Получаем гремлина
  const { data: gremlin, error: gremlinError } = await supabase
    .from('gremlins')
    .select('*')
    .eq('id', gremlin_id)
    .single()

  if (gremlinError) return res.status(404).json({ error: 'Gremlin not found' })

  // Получаем последние 20 записей для контекста
  const { data: recentEntries } = await supabase
    .from('entries')
    .select('content, entry_date')
    .eq('gremlin_id', gremlin_id)
    .order('entry_date', { ascending: false })
    .limit(20)

  // Параллельно: парсим данные и генерируем ответ
  const [parsed, reply] = await Promise.all([
    parseEntry(gremlin.role, content),
    chatWithGremlin(gremlin, content, recentEntries || [])
  ])

  // Сохраняем запись
  const { data: entry, error: entryError } = await supabase
    .from('entries')
    .insert({ gremlin_id, content, parsed_data: parsed })
    .select()
    .single()

  if (entryError) return res.status(500).json({ error: entryError.message })

  // Обновляем stats у гремлина если есть числа
  if (parsed && Object.keys(parsed).length > 0) {
    const currentStats = gremlin.stats || {}
    const updatedStats = mergeStats(currentStats, parsed, gremlin.role)

    await supabase
      .from('gremlins')
      .update({ stats: updatedStats })
      .eq('id', gremlin_id)
  }

  res.json({ entry, reply })
})

// Простая логика мержа статистики
function mergeStats(current, parsed, role) {
  const stats = { ...current }

  if (role === 'accountant' && parsed.total) {
    const today = new Date().toISOString().split('T')[0]
    stats.today_total = (stats.today_total || 0) + parsed.total
    stats.week_total = (stats.week_total || 0) + parsed.total
    stats.last_updated = today
  }

  if (role === 'trainer') {
    if (parsed.calories) stats.last_calories = parsed.calories
    if (parsed.workout) stats.last_workout = parsed.workout
    if (parsed.water_liters) stats.last_water = parsed.water_liters
  }

  if (role === 'secretary' && parsed.task) {
    stats.pending_tasks = (stats.pending_tasks || 0) + 1
    stats.last_task = parsed.task
  }

  return stats
}

module.exports = router
