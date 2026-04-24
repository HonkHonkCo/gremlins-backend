import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

export async function chatWithGremlin(gremlin, userMessage, recentEntries, otherGremlins = []) {
  const entriesText = recentEntries
    .map(e => `${e.entry_date}: ${e.content}`)
    .join('\n')

  // Контекст от других гремлинов
  const otherContext = otherGremlins.length > 0
    ? '\n\nДанные от других гремлинов пользователя:\n' + otherGremlins.map(g => {
        const stats = g.stats || {}
        const statsText = Object.entries(stats)
          .filter(([k]) => k !== 'last_updated')
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ')
        return `- ${g.name} (${g.role}): ${statsText || 'нет данных'}`
      }).join('\n')
    : ''

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `Ты гремлин по имени ${gremlin.name}. Твоя роль: ${gremlin.role}.
${gremlin.description ? `Описание: ${gremlin.description}` : ''}
Ты запоминаешь информацию которую тебе даёт пользователь и отвечаешь коротко и по делу.
Говори на русском. Будь немного с характером — ты гремлин, не скучный бот.
Если данные от других гремлинов помогают ответить лучше — используй их, но не перегружай ответ.

Последние записи которые ты помнишь:
${entriesText || 'Пока ничего нет.'}${otherContext}`
      },
      { role: 'user', content: userMessage }
    ],
    max_tokens: 500
  })

  return response.choices[0].message.content
}

export async function parseEntry(role, content) {
  let systemPrompt = ''

  if (role === 'accountant') {
    systemPrompt = `Ты парсер финансовых данных. Извлеки структурированные данные и верни ТОЛЬКО JSON.
Важно: разделяй валюты, разделяй расходы и доходы, отмечай инвестиции.
Формат:
{
  "type": "expense" | "income" | "investment" | "mixed",
  "items": [{"amount": 500, "currency": "THB", "category": "еда", "type": "expense"}],
  "totals": {
    "expense_thb": 0, "expense_rub": 0, "expense_usd": 0,
    "income_thb": 0, "income_rub": 0, "income_usd": 0,
    "investment_rub": 0, "investment_usd": 0
  }
}
Если валюта не указана — определи по контексту (бат=THB, рубль/руб=RUB, доллар/$=USD).
Если не можешь распознать — верни {}`
  } else if (role === 'trainer') {
    systemPrompt = `Ты парсер данных о здоровье. Верни ТОЛЬКО JSON:
{"calories": 1800, "workout": "бег 30 мин", "water_liters": 1.5, "weight_kg": null, "steps": null}
Если данных нет — верни {}`
  } else if (role === 'secretary') {
    systemPrompt = `Ты парсер задач и дедлайнов. Верни ТОЛЬКО JSON:
{"task": "название задачи", "amount": 1500, "currency": "RUB", "deadline": "2026-04-30", "priority": "high"|"medium"|"low"}
Если данных нет — верни {}`
  } else if (role === 'chef') {
    systemPrompt = `Ты парсер данных о питании. Верни ТОЛЬКО JSON:
{"meal": "название блюда", "calories": 500, "protein": 30, "carbs": 40, "fat": 15}
Если данных нет — верни {}`
  } else {
    systemPrompt = `Извлеки структурированные данные и верни ТОЛЬКО JSON без лишнего текста. Если не можешь — верни {}`
  }

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content }
    ],
    max_tokens: 400
  })

  try {
    const text = response.choices[0].message.content.trim()
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return {}
  }
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
