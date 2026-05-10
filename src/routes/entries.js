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

  // Загружаем полные данные по роли для контекста ИИ
  let fullContext = {}

  if (gremlin.role === 'accountant') {
    const [{ data: txs }, { data: accs }, { data: debts }] = await Promise.all([
      supabase.from('transactions').select('amount,currency,type,category,note,date').eq('gremlin_id', gremlin_id).order('date', { ascending: false }).limit(50),
      supabase.from('accounts').select('name,currency,balance').eq('gremlin_id', gremlin_id),
      supabase.from('debts').select('direction,person,amount,currency,status,note').eq('gremlin_id', gremlin_id).eq('status', 'active'),
    ])
    fullContext = { accounts: accs || [], transactions: txs || [], active_debts: debts || [] }
  }

  if (gremlin.role === 'trainer') {
    const { data: workouts } = await supabase.from('workouts').select('type,duration_min,distance_km,sets,reps,calories,date,note').eq('gremlin_id', gremlin_id).order('date', { ascending: false }).limit(30)
    fullContext = { workouts: workouts || [] }
  }

  if (gremlin.role === 'chef') {
    const { data: meals } = await supabase.from('meals').select('name,calories,protein,carbs,fat,meal_type,date').eq('gremlin_id', gremlin_id).order('date', { ascending: false }).limit(30)
    fullContext = { meals: meals || [] }
  }

  if (gremlin.role === 'secretary') {
    const { data: tasks } = await supabase.from('tasks').select('title,deadline,priority,status,repeat,description').eq('gremlin_id', gremlin_id).order('deadline', { ascending: true, nullsFirst: false }).limit(50)
    fullContext = { tasks: tasks || [] }
  }

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
    chatWithGremlin(gremlin, content, recentEntries || [], allGremlins || [], fullContext)
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

    // Для секретаря — создаём задачу в БД если ИИ её распарсил
    if (gremlin.role === 'secretary' && parsed.task) {
      const { data: newTask } = await supabase.from('tasks').insert({
        gremlin_id,
        title: parsed.task,
        deadline: parsed.deadline || null,
        priority: parsed.priority || 'medium',
        description: parsed.description || null,
        repeat: parsed.repeat || null,
        status: 'pending',
      }).select().single()

      // Пересчитываем stats через recalc
      const { data: allTasks } = await supabase
        .from('tasks').select('*').eq('gremlin_id', gremlin_id).eq('status', 'pending')
        .order('deadline', { ascending: true, nullsFirst: false })
      const pending = (allTasks || []).filter(t => !t.repeat)
      updatedStats.pending_tasks = pending.length
      updatedStats.next_tasks = pending.slice(0, 3).map(t => ({
        title: t.title, deadline: t.deadline || null, priority: t.priority || 'medium',
      }))
      updatedStats.next_deadline = pending.find(t => t.deadline)?.deadline || null
      updatedStats.next_task_title = pending[0]?.title || null
    }

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

      // Категории расходов — максимум 10
      const cats = stats.categories || {}
      for (const item of parsed.items) {
        if ((item.type || 'expense') !== 'expense') continue
        if (!item.category) continue
        const cat = item.category.toLowerCase().trim().slice(0, 20)
        if (!cat) continue
        cats[cat] = Math.round(((cats[cat] || 0) + (item.amount || 0)) * 100) / 100
      }
      // Если > 10 — мержим мелкие в "другое"
      const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1])
      if (sorted.length > 10) {
        const top9 = sorted.slice(0, 9)
        const otherSum = sorted.slice(9).reduce((s, [, v]) => s + v, 0)
        stats.categories = Object.fromEntries(top9)
        stats.categories['другое'] = Math.round(((stats.categories['другое'] || 0) + otherSum) * 100) / 100
      } else {
        stats.categories = cats
      }
    }
    stats.last_updated = new Date().toISOString().split('T')[0]
  }

  if (role === 'trainer') {
    if (parsed.calories != null) stats.last_calories = parsed.calories
    if (parsed.workout != null) stats.last_workout = parsed.workout
    if (parsed.workout_type != null) stats.last_workout_type = parsed.workout_type
    else if (parsed.workout != null) stats.last_workout_type = parsed.workout.split(' ')[0]
    if (parsed.water_liters != null) stats.last_water = parsed.water_liters
    if (parsed.weight_kg != null) stats.weight_kg = parsed.weight_kg
    if (parsed.steps != null) stats.steps = parsed.steps
    if (parsed.pushups != null) stats.last_pushups = parsed.pushups
    if (parsed.distance_km != null) stats.last_distance_km = parsed.distance_km
    if (parsed.duration_min != null) stats.last_duration_min = parsed.duration_min
    stats.last_updated = new Date().toISOString().split('T')[0]
  }

  if (role === 'secretary') {
    if (parsed.task) {
      // Создаём задачу через API если ИИ распарсил её
      // stats обновится через recalcSecretaryStats в tasks.js при POST
      stats.last_parsed_task = {
        title: parsed.task,
        deadline: parsed.deadline || null,
        priority: parsed.priority || 'medium',
        description: parsed.description || null,
        repeat: parsed.repeat || null,
      }
    }
  }

  if (role === 'chef') {
    const today = new Date().toISOString().split('T')[0]
    if (parsed.calories != null) {
      stats.last_calories = parsed.calories
      // Если запись сегодняшнего дня — суммируем в today_calories
      const lastDate = stats.today_date
      if (lastDate === today) {
        stats.today_calories = Math.round(((stats.today_calories || 0) + parsed.calories) * 10) / 10
        stats.today_protein = Math.round(((stats.today_protein || 0) + (parsed.protein || 0)) * 10) / 10
        stats.today_carbs = Math.round(((stats.today_carbs || 0) + (parsed.carbs || 0)) * 10) / 10
        stats.today_fat = Math.round(((stats.today_fat || 0) + (parsed.fat || 0)) * 10) / 10
      } else {
        // Новый день — сбрасываем дневные и переносим вчера в week
        const prevKcal = stats.today_calories || 0
        if (prevKcal > 0) {
          const week = stats.week_log || []
          week.push(prevKcal)
          if (week.length > 7) week.shift()
          stats.week_log = week
          stats.week_calories = Math.round(week.reduce((s, v) => s + v, 0))
        }
        stats.today_date = today
        stats.today_calories = parsed.calories
        stats.today_protein = parsed.protein || 0
        stats.today_carbs = parsed.carbs || 0
        stats.today_fat = parsed.fat || 0
      }
    }
    if (parsed.meal) stats.last_meal = parsed.meal
    if (parsed.protein != null) stats.last_protein = parsed.protein
  }

  return stats
}

export default router
