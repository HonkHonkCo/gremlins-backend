import { Router } from 'express'
import supabase from '../services/supabase.js'
import { writeSnapshot } from './snapshots.js'

const router = Router()

router.get('/', async (req, res) => {
  const { gremlin_id, type, limit = 50 } = req.query
  if (!gremlin_id) return res.status(400).json({ error: 'gremlin_id required' })
  let query = supabase.from('transactions').select('*').eq('gremlin_id', gremlin_id).order('date', { ascending: false }).order('created_at', { ascending: false }).limit(limit)
  if (type) query = query.eq('type', type)
  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/', async (req, res) => {
  const { gremlin_id, amount, currency, type, category, note, date, rate, end_date, account_id, to_account_id } = req.body
  if (!gremlin_id || !amount || !currency || !type) return res.status(400).json({ error: 'required fields missing' })

  const iso = currency.toUpperCase().trim()
  const isoLow = iso.toLowerCase()
  const num = Math.round(parseFloat(amount) * 100) / 100

  const { data: transaction, error } = await supabase.from('transactions')
    .insert({ gremlin_id, amount: num, currency: iso, type, category: category || null, note: note || null, date: date || new Date().toISOString().split('T')[0], rate: rate || null, end_date: end_date || null, account_id: account_id || null, to_account_id: to_account_id || null })
    .select().single()
  if (error) return res.status(500).json({ error: error.message })

  // Обновляем баланс счёта если указан
  if (account_id) {
    const { data: acc } = await supabase.from('accounts').select('balance').eq('id', account_id).single()
    if (acc) {
      const delta = type === 'expense' ? -num : type === 'income' ? num : 0
      await supabase.from('accounts').update({ balance: (acc.balance || 0) + delta }).eq('id', account_id)
    }
  }

  // Обновляем stats гремлина
  const { data: gremlin } = await supabase.from('gremlins').select('stats').eq('id', gremlin_id).single()
  const stats = { ...(gremlin?.stats || {}) }

  if (type === 'expense') {
    stats['expense_' + isoLow] = Math.round(((stats['expense_' + isoLow] || 0) + num) * 100) / 100
    const cats = stats.categories || {}
    const cat = (category || 'другое').toLowerCase()
    cats[cat] = Math.round(((cats[cat] || 0) + num) * 100) / 100
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

  stats['balance_' + isoLow] = Math.round(((stats['income_' + isoLow] || 0) - (stats['expense_' + isoLow] || 0)) * 100) / 100
  stats.last_updated = new Date().toISOString().split('T')[0]

  await supabase.from('gremlins').update({ stats, updated_at: new Date().toISOString() }).eq('id', gremlin_id)

  // Пишем снапшот для графика
  await writeSnapshot(gremlin_id, iso, stats['balance_' + isoLow] || 0)

  res.json({ transaction, stats })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params
  const { data: tx } = await supabase.from('transactions').select('*').eq('id', id).single()
  if (!tx) return res.status(404).json({ error: 'Not found' })
  await supabase.from('transactions').delete().eq('id', id)

  // Пересчёт баланса счёта если транзакция была привязана к счёту
  if (tx.account_id) {
    const { data: allAccTx } = await supabase.from('transactions')
      .select('amount, type')
      .eq('account_id', tx.account_id)
    const { data: acc } = await supabase.from('accounts').select('balance').eq('id', tx.account_id).single()
    if (acc) {
      // Пересчитываем баланс счёта: начальный баланс + все доходы - все расходы
      // Начальный баланс берём из текущего и откатываем удалённую транзакцию
      const delta = tx.type === 'expense' ? tx.amount : tx.type === 'income' ? -tx.amount : 0
      const newBalance = Math.round(((acc.balance || 0) + delta) * 100) / 100
      await supabase.from('accounts').update({ balance: newBalance }).eq('id', tx.account_id)
    }
  }

  // Также пересчёт to_account при переводе
  if (tx.to_account_id && tx.type === 'transfer') {
    const { data: toAcc } = await supabase.from('accounts').select('balance').eq('id', tx.to_account_id).single()
    if (toAcc) {
      const newBalance = Math.round(((toAcc.balance || 0) - tx.amount) * 100) / 100
      await supabase.from('accounts').update({ balance: newBalance }).eq('id', tx.to_account_id)
    }
  }

  // Пересчёт stats гремлина с нуля
  const { data: allTx } = await supabase.from('transactions').select('*').eq('gremlin_id', tx.gremlin_id)
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
  const currencies = new Set(Object.keys(stats).filter(k => k.startsWith('expense_') || k.startsWith('income_')).map(k => k.split('_').slice(1).join('_')))
  for (const cur of currencies) {
    stats['balance_' + cur] = Math.round(((stats['income_' + cur] || 0) - (stats['expense_' + cur] || 0)) * 100) / 100
    await writeSnapshot(tx.gremlin_id, cur.toUpperCase(), stats['balance_' + cur])
  }
  stats.last_updated = new Date().toISOString().split('T')[0]
  await supabase.from('gremlins').update({ stats, updated_at: new Date().toISOString() }).eq('id', tx.gremlin_id)
  res.json({ success: true, stats })
})

export default router
