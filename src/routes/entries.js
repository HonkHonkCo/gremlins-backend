import { Router } from 'express'
import supabase from '../services/supabase.js'
import { chatWithGremlin, parseEntry } from '../services/groq.js'

const router = Router()
const FREE_MESSAGES = 20

router.get('/', async (req, res) => {
  const { gremlin_id, limit = 60 } = req.query
  if (!gremlin_id) return res.status(400).json({ error: 'gremlin_id required' })

  const { data, error } = await supabase
    .from('entries')
    .select('id, content, reply, is_file, entry_date, created_at')
    .eq('gremlin_id', gremlin_id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/chat', async (req, res) => {
  const { gremlin_id, content, is_file, parsed_totals, file_name } = req.body
  if (!gremlin_id || !content) {
    return res.status(400).json({ error: 'gremlin_id and content required' })
  }

  const { data: gremlin, error: gremlinError } = await supabase
    .from('gremlins').select('*').eq('id', gremlin_id).single()

  if (gremlinError) return res.status(404).json({ error: 'Gremlin not found' })

  const { data: user } = await supabase
    .from('users').select('plan, messages_today, messages_date').eq('id', gremlin.user_id).single()

  if (user && user.plan !== 'pro') {
    const today = new Date().toISOString().split('T')[0]
    const messagesUsed = user.messages_date === today ? (user.messages_today || 0) : 0
    if (messagesUsed >= FREE_MESSAGES) {
      return res.status(403).json({
        error: 'message_limit_reached',
        message: 'Daily message limit reached. Upgrade to Pro.',
        used: messagesUsed,
        limit: FREE_MESSAGES
      })
    }
    await supabase.from('users')
      .update({ messages_today: messagesUsed + 1, messages_date: today })
      .eq('id', gremlin.user_id)
  }

  const { data: allGremlins } = await supabase
    .from('gremlins').select('id, name, role, stats')
    .eq('user_id', gremlin.user_id).neq('id', gremlin_id)

  const { data: recentEntries } = await supabase
    .from('entries')
    .select('content, reply, entry_date')
    .eq('gremlin_id', gremlin_id)
    .eq('is_file', false)
    .order('created_at', { ascending: false })
    .limit(20)

  // Если фронт уже распарсил файл — используем его данные, не тратим groq токены
  const parsedFromFront = parsed_totals && Object.keys(parsed_totals).length > 0

  const [parsed, reply] = await Promise.all([
    parsedFromFront
      ? Promise.resolve({ items: Object.entries(parsed_totals).map(([k, v]) => {
          const parts = k.split('_')
          const type = parts[0]
          const currency = parts.slice(1).join('_').toUpperCase()
          return { amount: v, currency, type }
        })}
      )
      : parseEntry(gremlin.role, content, !!is_file),
    chatWithGremlin(gremlin, content, recentEntries || [], allGremlins || [])
  ])

  // Для файлов сохраняем имя файла как content — в истории покажется как 📎 filename
  const contentToSave = is_file
    ? (file_name || 'файл')
    : content

  const { data: entry, error: entryError } = await supabase
    .from('entries')
    .insert({
      gremlin_id,
      content: contentToSave,
      reply,
      is_file: !!is_file,
      parsed_data: parsed,
      entry_date: new Date().toISOString().split('T')[0]
    })
    .select().single()

  if (entryError) return res.status(500).json({ error: entryError.message })

  let updatedStats = gremlin.stats || {}
  if (parsed && Object.keys(parsed).length > 0) {
    updatedStats = mergeStats(gremlin.stats || {}, parsed, gremlin.role)
    await supabase.from('gremlins')
      .update({ stats: updatedStats, updated_at: new Date().toISOString() })
      .eq('id', gremlin_id)
  }

  res.json({ entry, reply, stats: updatedStats })
})

function mergeStats(current, parsed, role) {
  const stats = { ...current }

  if (role === 'accountant') {
    if (parsed.items && Array.isArray(parsed.items)) {
      for (const item of parsed.items) {
        const amount = Math.round((item.amount || 0) * 100) / 100
        if (amount <= 0) continue

        // Нормализуем валюту — берём ISO код как есть, uppercase
        const currency = (item.currency || 'UNKNOWN').toUpperCase().trim()
        if (currency === 'UNKNOWN') continue // пропускаем непонятные

        const type = (item.type || 'expense').toLowerCase()
        const expKey = 'expense_' + currency.toLowerCase()
        const incKey = 'income_' + currency.toLowerCase()
        const balKey = 'balance_' + currency.toLowerCase()

        if (type === 'expense') {
          stats[expKey] = Math.round(((stats[expKey] || 0) + amount) * 100) / 100
        } else if (type === 'income') {
          stats[incKey] = Math.round(((stats[incKey] || 0) + amount) * 100) / 100
        } else if (type === 'investment') {
          const invKey = 'investment_' + currency.toLowerCase()
          stats[invKey] = Math.round(((stats[invKey] || 0) + amount) * 100) / 100
        }

        // Пересчитываем баланс для этой валюты
        stats[balKey] = Math.round(((stats[incKey] || 0) - (stats[expKey] || 0)) * 100) / 100
      }
    }
    stats.last_updated = new Date().toISOString().split('T')[0]
  }

  if (role === 'trainer') {
    if (parsed.calories != null) stats.last_calories = parsed.calories
    if (parsed.workout != null) stats.last_workout = parsed.workout
    if (parsed.water_liters != null) stats.last_water = parsed.water_liters
    if (parsed.weight_kg != null) stats.weight_kg = parsed.weight_kg
    if (parsed.steps != null) stats.steps = parsed.steps
    if (parsed.pushups != null) stats.last_pushups = parsed.pushups
    if (parsed.distance_km != null) stats.last_distance_km = parsed.distance_km
    stats.last_updated = new Date().toISOString().split('T')[0]
  }

  if (role === 'secretary') {
    if (parsed.task) {
      stats.pending_tasks = (stats.pending_tasks || 0) + 1
      stats.last_task = parsed.task
      if (parsed.deadline) stats.next_deadline = parsed.deadline
    }
  }

  if (role === 'chef') {
    if (parsed.calories != null) stats.last_calories = parsed.calories
    if (parsed.meal) stats.last_meal = parsed.meal
    if (parsed.protein != null) stats.last_protein = parsed.protein
  }

  return stats
}

export default router
