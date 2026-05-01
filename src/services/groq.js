import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

export async function chatWithGremlin(gremlin, userMessage, recentEntries, otherGremlins = []) {
  const entriesText = recentEntries
    .map(e => {
      const base = `${e.entry_date}: ${e.content}`
      return e.reply ? base + `
  → ты: ${e.reply.slice(0, 120)}` : base
    })
    .join('
')

  const statsText = gremlin.stats && Object.keys(gremlin.stats).length > 0
    ? '
Твоя накопленная статистика (включая данные из загруженных файлов):
' +
      Object.entries(gremlin.stats)
        .filter(([k, v]) => k !== 'last_updated' && v !== null && v !== undefined && v !== 0 && v !== '')
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('
')
    : ''

  const otherStats = otherGremlins.length > 0
    ? '
Данные других гремлинов пользователя:
' +
      otherGremlins.map(g => {
        const s = g.stats || {}
        const relevant = Object.entries(s)
          .filter(([k, v]) => k !== 'last_updated' && v !== null && v !== 0 && v !== '')
          .slice(0, 5)
        return `  ${g.name} (${g.role}): ${relevant.map(([k, v]) => `${k}=${v}`).join(', ') || 'нет данных'}`
      }).join('
')
    : ''

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `Ты гремлин по имени ${gremlin.name}. Твоя роль: ${gremlin.role}.
${gremlin.description ? `Описание: ${gremlin.description}` : ''}
Отвечай коротко и по делу на русском. Ты гремлин — с характером, не скучный бот.
Если спрашивают статус или итоги — используй данные из статистики ниже, они актуальны.
${statsText}${otherStats}

История переписки:
${entriesText || 'Пока ничего нет.'}`
      },
      { role: 'user', content: userMessage }
    ],
    max_tokens: 500
  })

  return response.choices[0].message.content
}

export async function parseEntry(role, content, isFile = false) {
  let systemPrompt = ''

  if (role === 'accountant') {
    if (isFile) {
      systemPrompt = `Ты финансовый аналитик. Тебе дан экспорт чата с финансовыми записями за несколько месяцев.
Проанализируй ВСЕ сообщения и суммируй расходы и доходы по валютам.

ПРАВИЛА ОПРЕДЕЛЕНИЯ ВАЛЮТЫ:
- $ / USD / долл / dollar = USD
- р / руб / рублей / ₽ / RUB = RUB  
- ฿ / бат / baht / THB = THB
- Если валюта не указана и контекст Таиланд — THB

ПРАВИЛА ОПРЕДЕЛЕНИЯ ТИПА:
- расход: купил, потратил, заплатил, цена X, X на [товар], X$ на [товар]
- доход: получил, зарплата, приход, доход, +X
- перевод между своими счетами ("с псб на сбер", "снял со счёта") — НЕ считай расходом/доходом
- "с 50$" означает остаток от купюры — НЕ доход, игнорируй эту часть

ВАЖНО: считай ТОЛЬКО реальные траты и доходы. Переводы между своими счетами игнорируй.

Верни ТОЛЬКО JSON без комментариев:
{
  "items": [
    {"amount": 3.15, "currency": "USD", "category": "кафе", "type": "expense", "date": "2026-02-01"}
  ],
  "totals": {
    "expense_thb": 0,
    "expense_rub": 0, 
    "expense_usd": 0,
    "income_thb": 0,
    "income_rub": 0,
    "income_usd": 0,
    "investment_rub": 0,
    "investment_usd": 0
  }
}
Если данных нет — верни {}`
    } else {
      systemPrompt = `Ты парсер финансовых данных. Пользователь пишет о расходах или доходах.

ПРАВИЛА ОПРЕДЕЛЕНИЯ ВАЛЮТЫ:
- $ / USD / долл = USD
- р / руб / рублей / ₽ = RUB
- ฿ / бат / baht / THB = THB  
- Если не указана — THB (контекст Таиланд)

ПРАВИЛА ТИПА:
- расход: купил, потратил, заплатил, X на [товар]
- доход: получил, зарплата, пришло, +X
- переводы между своими счетами — игнорируй

Верни ТОЛЬКО JSON:
{
  "items": [{"amount": 500, "currency": "THB", "category": "еда", "type": "expense"}],
  "totals": {"expense_thb": 0, "expense_rub": 0, "expense_usd": 0, "income_thb": 0, "income_rub": 0, "income_usd": 0, "investment_rub": 0, "investment_usd": 0}
}
Если данных нет — верни {}`
    }
  } else if (role === 'trainer') {
    systemPrompt = `Ты парсер данных о тренировках и здоровье. Извлекай ТОЛЬКО то, что пользователь реально написал.
НЕ придумывай данные которых нет. Если написал только про бег — не добавляй воду и калории.

Распознавай:
- бег X км / пробежал X = distance_km + workout
- отжимания X / X отжиманий = pushups
- вес X кг = weight_kg
- X калорий / ккал = calories
- X шагов = steps
- выпил X литров / воды X = water_liters

Верни ТОЛЬКО JSON (null для того чего не было):
{"calories": null, "workout": null, "water_liters": null, "weight_kg": null, "steps": null, "pushups": null, "distance_km": null}
Если данных нет — верни {}`
  } else if (role === 'secretary') {
    systemPrompt = `Ты парсер задач и дедлайнов. Верни ТОЛЬКО JSON:
{"task": "название задачи", "amount": null, "currency": null, "deadline": null, "priority": "medium"}
priority: "high" если срочно/важно, "low" если не горит, иначе "medium"
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
      { role: 'user', content: isFile ? content.slice(0, 12000) : content }
    ],
    max_tokens: isFile ? 4000 : 800
  })

  try {
    const text = response.choices[0].message.content.trim()
    // Убираем markdown если модель завернула в ```json
    const clean = text.replace(/^```json\n?/i, '').replace(/^```\n?/, '').replace(/\n?```$/, '')
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
