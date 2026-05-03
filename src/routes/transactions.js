import { Router } from 'express'
import supabase from '../services/supabase.js'

const router = Router()

// Получить транзакции гремлина
router.get('/', async (req, res) => {
  const { gremlin_id, limit = 50 } = req.query
  if (!gremlin_id) return res.status(400).json({ error: 'gremlin_id required' })

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('gremlin_id', gremlin_id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// Добавить транзакцию и пересчитать stats
router.post('/', async (req, res) => {
  const { gremlin_id, amount, currency, type, category, note } = req.body
  if (!gremlin_id || !amount || !currency || !type) {
    return res.status(400).json({ error: 'gremlin_id, amount, currency, type required' })
  }

  const iso = currency.toUpperCase().trim()
  const isoLow = iso.toLowerCase()
  const num = Math.round(parseFloat(amount) * 100) / 100

  const { data: transaction, error } = await supabase
    .from('transactions')
    .insert({ gremlin_id, amount: num, currency: iso, type, category: category || null, note: note || null })
    .select().single()

  if (error) return res.status(500).json({ error: error.message })

  // Пересчитываем stats гремлина
  const { data: gremlin } = await supabase.from('gremlins').select('stats').eq('id', gremlin_id).single()
  const stats = { ...(gremlin?.stats || {}) }

  if (type === 'expense') {
    stats['expense_' + isoLow] = Math.round(((stats['expense_' + isoLow] || 0) + num) * 100) / 100
    // Категория
    const cats = stats.categories || {}
    const cat = (category || 'другое').toLowerCase()
    cats[cat] = Math.round(((cats[cat] || 0) + num) * 100) / 100
    // Топ 10
    const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1])
    if (sorted.length > 10) {
      const other = sorted.slice(9).reduce((s, [, v]) => s + v, 0)
      stats.categories = Object.fromEntries(sorted.slice(0, 9))
      stats.categories['другое'] = Math.round(((stats.categories['другое'] || 0) + other) * 100) / 100
    } else {
      stats.categories = cats
    }
  } else if (type === 'income') {
    stats['income_' + isoLow] = Math.round(((stats['income_' + isoLow] || 0) + num) * 100) / 100
  } else if (type === 'investment') {
    stats['investment_' + isoLow] = Math.round(((stats['investment_' + isoLow] || 0) + num) * 100) / 100
  }

  // Пересчитываем баланс для этой валюты
  stats['balance_' + isoLow] = Math.round(((stats['income_' + isoLow] || 0) - (stats['expense_' + isoLow] || 0)) * 100) / 100
  stats.last_updated = new Date().toISOString().split('T')[0]

  await supabase.from('gremlins').update({ stats, updated_at: new Date().toISOString() }).eq('id', gremlin_id)

  res.json({ transaction, stats })
})

// Удалить транзакцию и пересчитать stats
router.delete('/:id', async (req, res) => {
  const { id } = req.params
  const { gremlin_id } = req.body

  const { data: tx } = await supabase.from('transactions').select('*').eq('id', id).single()
  if (!tx) return res.status(404).json({ error: 'Not found' })

  await supabase.from('transactions').delete().eq('id', id)

  // Пересчитываем stats с нуля по всем транзакциям
  const { data: allTx } = await supabase
    .from('transactions').select('*').eq('gremlin_id', tx.gremlin_id)

  const stats = { categories: {} }
  for (const t of allTx || []) {
    const isoLow = t.currency.toLowerCase()
    if (t.type === 'expense') {
      stats['expense_' + isoLow] = Math.round(((stats['expense_' + isoLow] || 0) + t.amount) * 100) / 100
      const cat = (t.category || 'другое').toLowerCase()
      stats.categories[cat] = Math.round(((stats.categories[cat] || 0) + t.amount) * 100) / 100
    } else if (t.type === 'income') {
      stats['income_' + isoLow] = Math.round(((stats['income_' + isoLow] || 0) + t.amount) * 100) / 100
    } else if (t.type === 'investment') {
      stats['investment_' + isoLow] = Math.round(((stats['investment_' + isoLow] || 0) + t.amount) * 100) / 100
    }
  }

  // Балансы
  const currencies = new Set(Object.keys(stats).filter(k => k.startsWith('expense_') || k.startsWith('income_')).map(k => k.split('_').slice(1).join('_')))
  for (const cur of currencies) {
    stats['balance_' + cur] = Math.round(((stats['income_' + cur] || 0) - (stats['expense_' + cur] || 0)) * 100) / 100
  }
  stats.last_updated = new Date().toISOString().split('T')[0]

  await supabase.from('gremlins').update({ stats, updated_at: new Date().toISOString() }).eq('id', tx.gremlin_id)

  res.json({ success: true, stats })
})

export default router
