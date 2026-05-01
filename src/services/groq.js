import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

export async function chatWithGremlin(gremlin, userMessage, recentEntries, otherGremlins = []) {
  const entriesText = recentEntries
    .map(e => {
      const base = `${e.entry_date}: ${e.content}`
      return e.reply ? base + '\n  → ты: ' + e.reply.slice(0, 120) : base
    })
    .join('\n')

  const statsText = gremlin.stats && Object.keys(gremlin.stats).length > 0
    ? '\nТвоя накопленная статистика (включая данные из загруженных файлов):\n' +
      Object.entries(gremlin.stats)
        .filter(([k, v]) => k !== 'last_updated' && v !== null && v !== undefined && v !== 0 && v !== '')
        .map(([k, v]) => '  ' + k + ': ' + v)
        .join('\n')
    : ''

  const otherStats = otherGremlins.length > 0
    ? '\nДанные других гремлинов пользователя:\n' +
      otherGremlins.map(g => {
        const s = g.stats || {}
        const relevant = Object.entries(s)
          .filter(([k, v]) => k !== 'last_updated' && v !== null && v !== 0 && v !== '')
          .slice(0, 5)
        return '  ' + g.name + ' (' + g.role + '): ' + (relevant.map(([k, v]) => k + '=' + v).join(', ') || 'нет данных')
      }).join('\n')
    : ''

  const systemContent = 'Ты гремлин по имени ' + gremlin.name + '. Твоя роль: ' + gremlin.role + '.\n' +
    (gremlin.description ? 'Описание: ' + gremlin.description + '\n' : '') +
    'Отвечай коротко и по делу на русском. Ты гремлин — с характером, не скучный бот.\n' +
    'Если спрашивают статус или итоги — используй данные из статистики ниже, они актуальны.\n' +
    statsText + otherStats + '\n\nИстория переписки:\n' +
    (entriesText || 'Пока ничего нет.')

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemContent },
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
      systemPrompt = 'Ты финансовый аналитик. Тебе дан экспорт чата с финансовыми записями за несколько месяцев.\n' +
        'Проанализируй ВСЕ сообщения и суммируй расходы и доходы по валютам.\n\n' +
        'ПРАВИЛА ОПРЕДЕЛЕНИЯ ВАЛЮТЫ:\n' +
        '- $ / USD / долл / dollar = USD\n' +
        '- р / руб / рублей / ₽ / RUB = RUB\n' +
        '- ฿ / бат / baht / THB = THB\n' +
        '- Если валюта не указана и контекст Таиланд — THB\n\n' +
        'ПРАВИЛА ОПРЕДЕЛЕНИЯ ТИПА:\n' +
        '- расход: купил, потратил, заплатил, "X на [товар]", "X$ на [товар]"\n' +
        '- доход: получил, зарплата, приход, +X\n' +
        '- перевод между своими счетами ("с псб на сбер", "снял со счёта") — НЕ считай расходом/доходом\n' +
        '- "с 50$" означает остаток от купюры — НЕ доход, игнорируй\n\n' +
        'Верни ТОЛЬКО JSON без комментариев:\n' +
        '{"items":[{"amount":3.15,"currency":"USD","category":"кафе","type":"expense"}],' +
        '"totals":{"expense_thb":0,"expense_rub":0,"expense_usd":0,"income_thb":0,"income_rub":0,"income_usd":0,"investment_rub":0,"investment_usd":0}}\n' +
        'Если данных нет — верни {}'
    } else {
      systemPrompt = 'Ты парсер финансовых данных. Пользователь пишет о расходах или доходах.\n\n' +
        'ПРАВИЛА ОПРЕДЕЛЕНИЯ ВАЛЮТЫ:\n' +
        '- $ / USD / долл = USD\n' +
        '- р / руб / рублей / ₽ = RUB\n' +
        '- ฿ / бат / baht / THB = THB\n' +
        '- Если не указана — THB (контекст Таиланд)\n\n' +
        'ПРАВИЛА ТИПА:\n' +
        '- расход: купил, потратил, заплатил, X на [товар]\n' +
        '- доход: получил, зарплата, пришло, +X\n' +
        '- переводы между своими счетами — игнорируй\n\n' +
        'Верни ТОЛЬКО JSON:\n' +
        '{"items":[{"amount":500,"currency":"THB","category":"еда","type":"expense"}],' +
        '"totals":{"expense_thb":0,"expense_rub":0,"expense_usd":0,"income_thb":0,"income_rub":0,"income_usd":0,"investment_rub":0,"investment_usd":0}}\n' +
        'Если данных нет — верни {}'
    }
  } else if (role === 'trainer') {
    systemPrompt = 'Ты парсер данных о тренировках. Извлекай ТОЛЬКО то что реально написал пользователь.\n' +
      'НЕ придумывай данные которых нет. Если написал только про бег — не добавляй воду и калории.\n\n' +
      'Распознавай:\n' +
      '- бег X км / пробежал X = distance_km + workout\n' +
      '- отжимания X / X отжиманий = pushups\n' +
      '- вес X кг = weight_kg\n' +
      '- X калорий / ккал = calories\n' +
      '- X шагов = steps\n' +
      '- выпил X литров / воды X = water_liters\n\n' +
      'Верни ТОЛЬКО JSON (null для того чего не было):\n' +
      '{"calories":null,"workout":null,"water_liters":null,"weight_kg":null,"steps":null,"pushups":null,"distance_km":null}\n' +
      'Если данных нет — верни {}'
  } else if (role === 'secretary') {
    systemPrompt = 'Ты парсер задач и дедлайнов. Верни ТОЛЬКО JSON:\n' +
      '{"task":"название задачи","amount":null,"currency":null,"deadline":null,"priority":"medium"}\n' +
      'priority: "high" если срочно/важно, "low" если не горит, иначе "medium"\n' +
      'Если данных нет — верни {}'
  } else if (role === 'chef') {
    systemPrompt = 'Ты парсер данных о питании. Верни ТОЛЬКО JSON:\n' +
      '{"meal":"название блюда","calories":null,"protein":null,"carbs":null,"fat":null}\n' +
      'Если данных нет — верни {}'
  } else {
    systemPrompt = 'Извлеки структурированные данные и верни ТОЛЬКО JSON. Если не можешь — верни {}'
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
    const clean = text.replace(/^```json\n?/i, '').replace(/^```\n?/, '').replace(/\n?```$/, '')
    return JSON.parse(clean)
  } catch {
    return {}
  }
}

export async function generateWeeklyReport(gremlins, allEntries) {
  const summaryData = gremlins.map(g => {
    const stats = g.stats || {}
    const statsStr = Object.entries(stats)
      .filter(([k, v]) => k !== 'last_updated' && v !== null && v !== 0)
      .map(([k, v]) => k + ': ' + v)
      .join(', ')
    return g.name + ' (' + g.role + '): ' + (statsStr || 'нет данных')
  }).join('\n')

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Ты составляешь еженедельный отчёт для пользователя по его гремлинам. ' +
          'Напиши краткий дружелюбный итог недели на русском, максимум 200 слов. ' +
          'Отметь успехи, предупреди о проблемах, дай 1-2 совета.'
      },
      {
        role: 'user',
        content: 'Данные гремлинов за неделю:\n' + summaryData
      }
    ],
    max_tokens: 600
  })

  return response.choices[0].message.content
}
