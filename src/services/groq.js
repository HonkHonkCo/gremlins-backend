import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

export async function chatWithGremlin(gremlin, userMessage, recentEntries) {
  const entriesText = recentEntries
    .map(e => `${e.entry_date}: ${e.content}`)
    .join('\n')

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `Ты гремлин по имени ${gremlin.name}. Твоя роль: ${gremlin.role}.
${gremlin.description ? `Описание: ${gremlin.description}` : ''}
Ты запоминаешь информацию которую тебе даёт пользователь и отвечаешь коротко и по делу.
Говори на русском. Будь немного с характером — ты гремлин, не скучный бот.

Последние записи которые ты помнишь:
${entriesText || 'Пока ничего нет.'}`
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
    systemPrompt = `Ты парсер финансовых данных. Пользователь передаёт информацию о расходах, доходах или инвестициях — текстом или из файла.
Твоя задача: извлечь ВСЕ суммы и вернуть ТОЛЬКО JSON.
ВАЖНО: определяй валюту по контексту: ฿/бат/baht = THB, руб/рублей/₽ = RUB, $/USD/долл = USD. Если не указана — THB (по умолчанию для Таиланда).
Разделяй расходы (трата, купил, заплатил, потратил) и доходы (получил, зарплата, доход).
Формат ответа:
{
  "items": [{"amount": 500, "currency": "THB", "category": "еда", "type": "expense"}],
  "totals": {
    "expense_thb": 0, "expense_rub": 0, "expense_usd": 0,
    "income_thb": 0, "income_rub": 0, "income_usd": 0,
    "investment_rub": 0, "investment_usd": 0
  }
}
Если данных нет — верни {}`
  } else if (role === 'trainer') {
    systemPrompt = `Ты парсер данных о тренировках и здоровье. Извлекай ТОЛЬКО то, что пользователь реально сообщил.
НЕ придумывай данные которых нет в сообщении. Если пользователь написал только про бег — не добавляй воду и калории.
Верни ТОЛЬКО JSON:
{"calories": null, "workout": null, "water_liters": null, "weight_kg": null, "steps": null, "pushups": null, "distance_km": null}
Заполняй только те поля, о которых говорит пользователь. Остальные оставь null.
Если данных нет — верни {}`
  } else if (role === 'secretary') {
    systemPrompt = `Ты парсер задач и дедлайнов. Верни ТОЛЬКО JSON:
{"task": "название задачи", "amount": null, "currency": null, "deadline": null, "priority": "medium"}
Если данных нет — верни {}`
  } else if (role === 'chef') {
    systemPrompt = `Ты парсер данных о питании. Верни ТОЛЬКО JSON:
{"meal": "название блюда", "calories": null, "protein": null, "carbs": null, "fat": null}
Если данных нет — верни {}`
  } else {
    systemPrompt = `Извлеки структурированные данные и верни ТОЛЬКО JSON. Если не можешь — верни {}`
  }

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content }
    ],
    max_tokens: 600
  })

  try {
    return JSON.parse(response.choices[0].message.content)
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
