import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

export async function chatWithGremlin(gremlin, userMessage, recentEntries, otherGremlins = []) {
  const entriesText = recentEntries
    .map(e => {
      const base = e.entry_date + ': ' + e.content
      return e.reply ? base + '\n  → ты: ' + e.reply.slice(0, 120) : base
    })
    .join('\n')

  const statsText = gremlin.stats && Object.keys(gremlin.stats).length > 0
    ? '\nТвоя накопленная статистика:\n' +
      Object.entries(gremlin.stats)
        .filter(([k, v]) => k !== 'last_updated' && v !== null && v !== undefined && v !== 0 && v !== '')
        .map(([k, v]) => '  ' + k + ': ' + v)
        .join('\n')
    : ''

  const otherStats = otherGremlins.length > 0
    ? '\nДанные других гремлинов:\n' +
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
    const baseRules = 'ПРАВИЛА ОПРЕДЕЛЕНИЯ ВАЛЮТЫ:\n' +
      '- $ / USD / долл / dollar = USD\n' +
      '- р / руб / рублей / ₽ / RUB = RUB\n' +
      '- ฿ / бат / baht / THB = THB\n' +
      '- Rp / рп / IDR / рупий = IDR\n' +
      '- € / евро / EUR = EUR\n' +
      '- £ / фунт / GBP = GBP\n' +
      '- AUD / австр = AUD\n' +
      '- ЛЮБУЮ другую валюту определяй по ISO коду (3 буквы)\n\n' +
      'ПРАВИЛА ТИПА:\n' +
      '- expense: купил, потратил, заплатил, "X на [товар]"\n' +
      '- income: получил, зарплата, пришло, +X\n' +
      '- income: "у меня есть X", "наличка X", "остаток X", "на счёте X" — это текущий баланс, записывай как income\n' +
      '- Переводы между своими счетами ("с псб на сбер") — пропускай\n' +
      '- "с 50$" = остаток купюры — игнорируй\n' +
      '- Если валюта неясна — используй "UNKNOWN"\n\n'

    if (isFile) {
      systemPrompt = 'Ты финансовый аналитик. Тебе дан экспорт чата с финансовыми записями.\n' +
        'Извлеки ВСЕ финансовые операции.\n\n' +
        baseRules +
        'Верни ТОЛЬКО JSON:\n' +
        '{"items":[{"amount":3.15,"currency":"USD","category":"кафе","type":"expense","date":"2026-02-01"}]}\n' +
        'Если данных нет — верни {}'
    } else {
      systemPrompt = 'Ты парсер финансовых данных. Извлеки операции из сообщения пользователя.\n\n' +
        baseRules +
        'Верни ТОЛЬКО JSON:\n' +
        '{"items":[{"amount":500,"currency":"THB","category":"еда","type":"expense"}]}\n' +
        'Если данных нет — верни {}'
    }
  } else if (role === 'trainer') {
    systemPrompt = 'Ты парсер данных о тренировках. Извлекай ТОЛЬКО то что реально написал пользователь.\n' +
      'НЕ придумывай данные которых нет.\n\n' +
      'Распознавай:\n' +
      '- бег X км / пробежал X = distance_km + workout\n' +
      '- отжимания X = pushups\n' +
      '- вес X кг = weight_kg\n' +
      '- X калорий / ккал = calories\n' +
      '- X шагов = steps\n' +
      '- воды X литров = water_liters\n\n' +
      'Верни ТОЛЬКО JSON (null для отсутствующих):\n' +
      '{"calories":null,"workout":null,"water_liters":null,"weight_kg":null,"steps":null,"pushups":null,"distance_km":null}\n' +
      'Если данных нет — верни {}'
  } else if (role === 'secretary') {
    systemPrompt = 'Ты парсер задач. Верни ТОЛЬКО JSON:\n' +
      '{"task":"название","amount":null,"currency":null,"deadline":null,"priority":"medium"}\n' +
      'priority: high/medium/low. Если данных нет — верни {}'
  } else if (role === 'chef') {
    systemPrompt = 'Ты парсер питания. Верни ТОЛЬКО JSON:\n' +
      '{"meal":"блюдо","calories":null,"protein":null,"carbs":null,"fat":null}\n' +
      'Если данных нет — верни {}'
  } else {
    systemPrompt = 'Извлеки данные и верни ТОЛЬКО JSON. Если не можешь — верни {}'
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
      { role: 'user', content: 'Данные гремлинов за неделю:\n' + summaryData }
    ],
    max_tokens: 600
  })

  return response.choices[0].message.content
}

// Генерация персонального совета для push-уведомления
export async function generateGremlinAdvice(gremlin) {
  const stats = gremlin.stats || {}
  const statsStr = Object.entries(stats)
    .filter(([k, v]) => k !== 'last_updated' && v !== null && v !== 0 && v !== '')
    .map(([k, v]) => k + ': ' + v)
    .join(', ')

  const roleContext = {
    accountant: 'финансовый гремлин-бухгалтер. Комментируй траты, баланс, предупреждай о перерасходе.',
    trainer: 'гремлин-тренер. Мотивируй на тренировку, комментируй прогресс.',
    secretary: 'гремлин-секретарь. Напоминай о задачах и дедлайнах.',
    chef: 'гремлин-повар. Давай советы по питанию.'
  }

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Ты ' + (roleContext[gremlin.role] || 'гремлин') + ' по имени ' + gremlin.name + '.\n' +
          'Напиши ОДИН короткий совет или комментарий (2-3 предложения) на основе статистики пользователя.\n' +
          'Пиши в стиле гремлина — с характером, иронично, но по делу. На русском.'
      },
      {
        role: 'user',
        content: 'Моя текущая статистика: ' + (statsStr || 'данных пока нет') + '\nДай совет.'
      }
    ],
    max_tokens: 150
  })

  return response.choices[0].message.content
}

// AI определяет валюты по меткам — минимальный промпт, ~50 токенов входа
export async function resolvecurrencies(groups) {
  const groupsText = Object.entries(groups)
    .map(([label, g]) => {
      const parts = []
      if (g.expense > 0) parts.push('расход=' + g.expense)
      if (g.income > 0) parts.push('доход=' + g.income)
      return '"' + label + '": ' + parts.join(', ') + (g.samples.length ? ' (пример: ' + g.samples[0] + ')' : '')
    })
    .join('\n')

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'Ты определяешь ISO-код валюты по текстовой метке из финансовых записей.\n' +
          'Известные метки: рп/rp/idr→IDR, $→USD, руб/р/₽/rub→RUB, бат/฿/thb→THB, €/eur/евро→EUR, £/gbp→GBP\n' +
          'Если метка неизвестна — угадай по контексту примера или напиши "?".\n\n' +
          'Верни ТОЛЬКО JSON массив:\n' +
          '[{"label":"рп","iso":"IDR","expense":45000,"income":0},{"label":"$","iso":"USD","expense":127.5,"income":50}]\n' +
          'Не добавляй комментариев, только JSON.'
      },
      { role: 'user', content: groupsText }
    ],
    max_tokens: 300
  })

  try {
    const text = response.choices[0].message.content.trim()
    const clean = text.replace(/^```json\n?/i, '').replace(/^```\n?/, '').replace(/\n?```$/, '')
    const result = JSON.parse(clean)
    // Возвращаем массив и список непонятных меток
    const unknown = result.filter(r => r.iso === '?').map(r => r.label)
    return { resolved: result.filter(r => r.iso !== '?'), unknown }
  } catch {
    return { resolved: [], unknown: Object.keys(groups) }
  }
}
