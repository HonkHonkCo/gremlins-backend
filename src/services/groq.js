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
  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `Ты парсер данных. Пользователь говорит своему гремлину (роль: ${role}) что-то.
Извлеки структурированные данные и верни ТОЛЬКО JSON без лишнего текста.
Например для бухгалтера: {"items": [{"amount": 650, "category": "такси"}, {"amount": 200, "category": "кофе"}], "total": 850}
Для тренера: {"calories": 1800, "workout": "бег 30 мин", "water_liters": 1.5}
Для секретаря: {"task": "штраф ГИБДД", "amount": 1500, "deadline": "2026-04-30"}
Если не можешь распознать — верни {}`
      },
      { role: 'user', content }
    ],
    max_tokens: 300
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
