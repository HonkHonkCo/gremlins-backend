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
  const { gremlin_id, content, is_file } = req.body
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
        message: `Daily message limit reached (${FREE_MESSAGES}). Upgrade to Pro for unlimited messages.`,
        used: messagesUsed,
        limit: FREE_MESSAGES
      })
    }

    await supabase
      .from('users')
      .update({ messages_today: messagesUsed + 1, messages_date: today })
      .eq('id', gremlin.user_id)
  }

  const { data: allGremlins } = await supabase
    .from('gremlins').select('id, name, role, stats').eq('user_id', gremlin.user_id).neq('id', gremlin_id)

  const { data: recentEntries } = await supabase
    .from('entries')
    .select('content, reply, entry_date')
    .eq('gremlin_id', gremlin_id)
    .eq('is_file', false)
    .order('created_at', { ascending: false })
    .limit(20)

  const [parsed, reply] = await Promise.all([
    is_file ? Promise.resolve({}) : parseEntry(gremlin.role, content),
    chatWithGremlin(gremlin, content, recentEntries || [], allGremlins || [])
  ])

  // Для файлов сохраняем только короткое описание, не весь контент
  const contentToSave = is_file
    ? content.slice(0, 200) + (content.length > 200 ? '...[файл]' : '')
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
    .select()
    .single()

  if (entryError) return res.status(500).json({ error: entryError.message })

  let updatedStats = gremlin.stats || {}
  if (parsed && Object.keys(parsed).length > 0) {
    updatedStats = mergeStats(gremlin.stats || {}, parsed, gremlin.role)
    await supabase.from('gremlins').update({ stats: updatedStats, updated_at: new Date().toISOString() }).eq('id', gremlin_id)
  }

  res.json({ entry, reply, stats: updatedStats })
})

function mergeStats(current, parsed, role) {
  const stats = { ...current }

  if (role === 'accountant') {
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
    }
    if (parsed.items && Array.isArray(parsed.items)) {
      for (const item of parsed.items) {
        const amount = item.amount || 0
        const currency = (item.currency || 'THB').toUpperCase()
        const type = item.type || 'expense'
        if (type === 'expense') {
          if (currency === 'THB') stats.expense_thb = (stats.expense_thb || 0) + amount
          else if (currency === 'RUB') stats.expense_rub = (stats.expense_rub || 0) + amount
          else if (currency === 'USD') stats.expense_usd = (stats.expense_usd || 0) + amount
        } else if (type === 'income') {
          if (currency === 'THB') stats.income_thb = (stats.income_thb || 0) + amount
          else if (currency === 'RUB') stats.income_rub = (stats.income_rub || 0) + amount
          else if (currency === 'USD') stats.income_usd = (stats.income_usd || 0) + amount
        } else if (type === 'investment') {
          if (currency === 'RUB') stats.investment_rub = (stats.investment_rub || 0) + amount
          else if (currency === 'USD') stats.investment_usd = (stats.investment_usd || 0) + amount
        }
      }
    }
    if (parsed.total && !parsed.items && !parsed.totals) {
      stats.expense_thb = (stats.expense_thb || 0) + parsed.total
    }
    stats.balance_thb = (stats.income_thb || 0) - (stats.expense_thb || 0)
    stats.balance_rub = (stats.income_rub || 0) - (stats.expense_rub || 0)
    stats.balance_usd = (stats.income_usd || 0) - (stats.expense_usd || 0)
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
