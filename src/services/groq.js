import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

export async function chatWithGremlin(gremlin, userMessage, recentEntries, allGremlins, fullContext = {}) {
  const entriesText = recentEntries
    .map(e => `${e.entry_date}: ${e.content}`)
    .join('\n')

  let dataContext = ''

  if (gremlin.role === 'accountant' && fullContext.accounts) {
    const { accounts = [], transactions = [], active_debts = [] } = fullContext
    const accLines = accounts.map(a =>
      `  • ${a.name}: ${a.balance?.toLocaleString('ru-RU')} ${a.currency}`
    ).join('\n')
    const lastTx = transactions.slice(0, 10).map(t =>
      `  ${t.date} [${t.type}] ${t.amount} ${t.currency}${t.category ? ' / ' + t.category : ''}${t.note ? ' — ' + t.note : ''}`
    ).join('\n')
    const debtLines = active_debts.map(d =>
      `  ${d.direction === 'gave' ? 'Дал' : 'Взял'} ${d.amount} ${d.currency} у/от ${d.person}${d.note ? ' (' + d.note + ')' : ''}`
    ).join('\n')
    dataContext = `
=== ФИНАНСОВЫЕ ДАННЫЕ ===
СЧЕТА:
${accLines || '  нет счетов'}

ПОСЛЕДНИЕ ОПЕРАЦИИ:
${lastTx || '  нет операций'}

АКТИВНЫЕ ДОЛГИ:
${debtLines || '  нет долгов'}
`
  }

  if (gremlin.role === 'trainer' && fullContext.workouts) {
    const ws = fullContext.workouts
    const last5 = ws.slice(0, 5).map(w =>
      `  ${w.date} ${w.type}${w.duration_min ? ' ' + w.duration_min + 'мин' : ''}${w.distance_km ? ' ' + w.distance_km + 'км' : ''}${w.sets && w.reps ? ' ' + w.sets + 'х' + w.reps : ''}${w.calories ? ' ~' + w.calories + 'ккал' : ''}${w.note ? ' — ' + w.note : ''}`
    ).join('\n')
    const totalKcal = ws.reduce((s, w) => s + (w.calories || 0), 0)
    const types = [...new Set(ws.map(w => w.type))].join(', ')
    dataContext = `
=== ТРЕНИРОВКИ ===
Последние 5:
${last5 || '  нет тренировок'}

Всего тренировок: ${ws.length}, виды: ${types || 'нет'}
Сожжено калорий (всего): ${totalKcal}
`
  }

  if (gremlin.role === 'chef' && fullContext.meals) {
    const meals = fullContext.meals
    const today = new Date().toISOString().split('T')[0]
    const todayMeals = meals.filter(m => m.date === today)
    const last5 = meals.slice(0, 5).map(m =>
      `  ${m.date} [${m.meal_type || '?'}] ${m.name}${m.calories ? ' ' + m.calories + 'ккал' : ''}${m.protein ? ' Б' + Math.round(m.protein) + 'г' : ''}${m.carbs ? ' У' + Math.round(m.carbs) + 'г' : ''}${m.fat ? ' Ж' + Math.round(m.fat) + 'г' : ''}`
    ).join('\n')
    const todayKcal = todayMeals.reduce((s, m) => s + (m.calories || 0), 0)
    const todayProt = todayMeals.reduce((s, m) => s + (m.protein || 0), 0)
    const todayCarbs = todayMeals.reduce((s, m) => s + (m.carbs || 0), 0)
    dataContext = `
=== ПИТАНИЕ ===
Сегодня (${today}): ${todayKcal} ккал, Б${Math.round(todayProt)}г, У${Math.round(todayCarbs)}г (${todayMeals.length} приёмов)

Последние записи:
${last5 || '  нет записей'}
`
  }

  if (gremlin.role === 'secretary' && fullContext.tasks) {
    const tasks = fullContext.tasks
    const pending = tasks.filter(t => t.status === 'pending' && !t.repeat)
    const regular = tasks.filter(t => t.repeat)
    const pendingLines = pending.slice(0, 10).map(t => {
      const daysLeft = t.deadline ? Math.ceil((new Date(t.deadline) - new Date()) / 86400000) : null
      const urgency = daysLeft === null ? '' : daysLeft < 0 ? ' [ПРОСРОЧЕНО]' : daysLeft === 0 ? ' [СЕГОДНЯ]' : daysLeft === 1 ? ' [ЗАВТРА]' : ` [через ${daysLeft}д]`
      return `  [${t.priority}] ${t.title}${t.deadline ? ' до ' + t.deadline : ''}${urgency}`
    }).join('\n')
    const regularLines = regular.map(t =>
      `  [${t.repeat}] ${t.title}${t.deadline ? ' (след: ' + t.deadline + ')' : ''}`
    ).join('\n')
    dataContext = `
=== ЗАДАЧИ ===
В работе (${pending.length}):
${pendingLines || '  нет задач'}

Регулярные (${regular.length}):
${regularLines || '  нет регулярных'}
`
  }

  const siblingsText = allGremlins?.length
    ? '\n=== ДРУГИЕ ГРЕМЛИНЫ ===\n' + allGremlins.map(g =>
        `${g.name} (${g.role}): ${JSON.stringify(g.stats || {}).slice(0, 150)}`
      ).join('\n')
    : ''

  const roleInstructions = {
    accountant: 'Ты следишь за финансами. Знаешь все счета, вклады с процентами и сроками, активные долги.',
    trainer: 'Ты следишь за тренировками. Знаешь все тренировки, можешь анализировать прогресс.',
    chef: 'Ты следишь за питанием. Знаешь все приёмы пищи, КБЖУ за день и неделю.',
    secretary: 'Ты следишь за задачами. Знаешь все задачи включая регулярные. Можешь создать новую задачу если пользователь просит.',
  }

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `Ты гремлин по имени ${gremlin.name}. Твоя роль: ${gremlin.role}.
${gremlin.description ? `Описание: ${gremlin.description}` : ''}
${roleInstructions[gremlin.role] || ''}
ВАЖНО: Обращайся к пользователю на "ты". Не называй его своим именем.
Говори на русском. Будь немного с характером — ты гремлин, не скучный бот.
Отвечай коротко (2-4 предложения) если не просят подробнее.
${dataContext}${siblingsText}
=== ИСТОРИЯ ДИАЛОГА ===
${entriesText || 'Пока ничего нет.'}`
      },
      { role: 'user', content: userMessage }
    ],
    max_tokens: 600
  })

  return response.choices[0].message.content
}

export async function parseEntry(role, content) {
  const roleSchemas = {
    accountant: `{"items": [{"amount": 650, "currency": "THB", "type": "expense", "category": "такси", "note": ""}], "total": 650}`,
    trainer: `{"calories": 1800, "workout": "бег", "workout_type": "бег", "duration_min": 30, "distance_km": 5, "sets": 3, "reps": 15, "weight_kg": 70, "water_liters": 1.5, "pushups": 20}`,
    secretary: `{"task": "название", "description": "детали", "deadline": "2026-06-15", "priority": "high|medium|low", "repeat": "daily|weekly|monthly|null"}`,
    chef: `{"meal": "название блюда", "meal_type": "завтрак|обед|ужин|перекус", "calories": 450, "protein": 25, "carbs": 60, "fat": 12}`,
  }

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `Ты парсер данных. Извлеки структурированные данные из сообщения пользователя гремлину (роль: ${role}).
Верни ТОЛЬКО JSON без markdown и без блоков кода.
Схема: ${roleSchemas[role] || '{}'}
Если не можешь распознать — верни {}`
      },
      { role: 'user', content }
    ],
    max_tokens: 400
  })

  try {
    const text = response.choices[0].message.content.trim().replace(/```json|```/g, '').trim()
    return JSON.parse(text)
  } catch {
    return {}
  }
}

export async function calcKBJU(foodName, weight_g) {
  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `Ты нутрициолог. Дай примерное КБЖУ для блюда.
Верни ТОЛЬКО JSON без markdown: {"calories": 250, "protein": 10, "carbs": 30, "fat": 8}
Всё на 100г если вес не указан, иначе на указанный вес.`
      },
      { role: 'user', content: `${foodName}${weight_g ? ', ' + weight_g + 'г' : ''}` }
    ],
    max_tokens: 100
  })

  try {
    const text = response.choices[0].message.content.trim().replace(/```json|```/g, '').trim()
    return JSON.parse(text)
  } catch {
    return {}
  }
}

export async function generateGremlinAdvice(gremlin) {
  const stats = gremlin.stats || {}
  const role = gremlin.role

  const roleContext = {
    accountant: `Финансовый гремлин. Статистика: ${JSON.stringify(stats)}`,
    trainer: `Тренер-гремлин. Статистика: ${JSON.stringify(stats)}`,
    chef: `Шеф-гремлин. Статистика: ${JSON.stringify(stats)}`,
    secretary: `Секретарь-гремлин. Задач в работе: ${stats.pending_tasks || 0}, ближайший дедлайн: ${stats.next_deadline || 'нет'}`,
  }

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `Ты гремлин по имени ${gremlin.name} (роль: ${role}).
Напиши короткое (1-2 предложения) мотивационное сообщение пользователю на основе его данных.
Будь конкретным, используй цифры. Говори на русском, с характером гремлина.`
      },
      {
        role: 'user',
        content: roleContext[role] || `Данные: ${JSON.stringify(stats)}`
      }
    ],
    max_tokens: 150
  })

  return response.choices[0].message.content
}

export async function generateWeeklyReport(userOrObj, gremlinsWithEntries) {
  let context

  if (userOrObj && userOrObj.entries) {
    const { userLabel, entries } = userOrObj
    context = `Пользователь: ${userLabel}\n\nЗаписи за неделю:\n` +
      entries.map(e => `[${e.gremlin_name || 'гремлин'}] ${e.created_at?.slice(0, 10)}: ${e.raw_text || e.content || ''}`).join('\n')
  } else {
    context = (gremlinsWithEntries || []).map(g => `
Гремлин: ${g.name} (${g.role})
Статистика: ${JSON.stringify(g.stats)}
Записи за неделю:
${g.entries.map(e => `- ${e.entry_date}: ${e.content}`).join('\n')}
`).join('\n---\n')
  }

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `Ты главный гремлин который делает еженедельный отчёт.
Проанализируй данные от всех гремлинов и напиши короткое резюме недели.
Говори на русском, будь конкретным — цифры, факты, одна-две рекомендации.
Максимум 200 слов.`
      },
      { role: 'user', content: context }
    ],
    max_tokens: 600
  })

  return response.choices[0].message.content
}
