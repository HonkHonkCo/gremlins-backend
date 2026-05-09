import { Router } from 'express'
import supabase from '../services/supabase.js'

const router = Router()

router.get('/', async (req, res) => {
  const { gremlin_id } = req.query
  if (!gremlin_id) return res.status(400).json({ error: 'gremlin_id required' })
  const { data, error } = await supabase.from('debts').select('*').eq('gremlin_id', gremlin_id).order('date', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/', async (req, res) => {
  const { gremlin_id, direction, person, amount, currency, note, date, account_id } = req.body
  if (!gremlin_id || !direction || !person || !amount || !currency)
    return res.status(400).json({ error: 'required fields missing' })

  const num = Math.round(parseFloat(amount) * 100) / 100
  const iso = currency.toUpperCase()

  const { data, error } = await supabase.from('debts')
    .insert({ gremlin_id, direction, person, amount: num, currency: iso, note, date: date || new Date().toISOString().split('T')[0], account_id: account_id || null })
    .select().single()
  if (error) return res.status(500).json({ error: error.message })

  // Обновляем баланс счёта если указан
  // gave (дал) = деньги ушли со счёта (-), took (взял) = деньги пришли (+)
  if (account_id) {
    const { data: acc } = await supabase.from('accounts').select('balance').eq('id', account_id).single()
    if (acc) {
      const delta = direction === 'gave' ? -num : num
      await supabase.from('accounts').update({ balance: Math.round(((acc.balance || 0) + delta) * 100) / 100 }).eq('id', account_id)
    }
  }

  // Обновляем stats гремлина
  const { data: gremlin } = await supabase.from('gremlins').select('stats').eq('id', gremlin_id).single()
  const stats = { ...(gremlin?.stats || {}) }
  const isoLow = iso.toLowerCase()
  // Отражаем долги в stats для отображения на главном экране
  stats['debt_gave_' + isoLow] = Math.round(((stats['debt_gave_' + isoLow] || 0) + (direction === 'gave' ? num : 0)) * 100) / 100
  stats['debt_took_' + isoLow] = Math.round(((stats['debt_took_' + isoLow] || 0) + (direction === 'took' ? num : 0)) * 100) / 100
  stats.last_updated = new Date().toISOString().split('T')[0]
  await supabase.from('gremlins').update({ stats, updated_at: new Date().toISOString() }).eq('id', gremlin_id)

  res.json(data)
})

router.patch('/:id', async (req, res) => {
  const { status } = req.body
  const { data: debt } = await supabase.from('debts').select('*').eq('id', req.params.id).single()
  const { data, error } = await supabase.from('debts').update({ status }).eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })

  // При погашении долга — возвращаем деньги на счёт
  // gave → нам вернули → деньги приходят (+), took → мы вернули → деньги уходят (-)
  if (status === 'settled' && debt?.account_id) {
    const { data: acc } = await supabase.from('accounts').select('balance').eq('id', debt.account_id).single()
    if (acc) {
      const delta = debt.direction === 'gave' ? debt.amount : -debt.amount
      await supabase.from('accounts').update({ balance: Math.round(((acc.balance || 0) + delta) * 100) / 100 }).eq('id', debt.account_id)
    }
  }

  res.json(data)
})

router.delete('/:id', async (req, res) => {
  const { data: debt } = await supabase.from('debts').select('*').eq('id', req.params.id).single()
  await supabase.from('debts').delete().eq('id', req.params.id)

  // Откатываем баланс счёта если долг был привязан и ещё активен
  if (debt?.account_id && debt?.status === 'active') {
    const { data: acc } = await supabase.from('accounts').select('balance').eq('id', debt.account_id).single()
    if (acc) {
      // Откат: gave (дал) — деньги возвращаем (+), took (взял) — деньги забираем (-)
      const delta = debt.direction === 'gave' ? debt.amount : -debt.amount
      await supabase.from('accounts').update({ balance: Math.round(((acc.balance || 0) + delta) * 100) / 100 }).eq('id', debt.account_id)
    }
  }

  res.json({ success: true })
})

export default router
