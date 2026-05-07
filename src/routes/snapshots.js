import { Router } from 'express'
import supabase from '../services/supabase.js'

const router = Router()

// Получить снапшоты для графика
router.get('/', async (req, res) => {
  const { gremlin_id, currency, days = 30 } = req.query
  if (!gremlin_id) return res.status(400).json({ error: 'gremlin_id required' })

  let query = supabase.from('balance_snapshots').select('*').eq('gremlin_id', gremlin_id)
  if (currency) query = query.eq('currency', currency.toUpperCase())

  const fromDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
  const { data, error } = await query.gte('snapshot_date', fromDate).order('snapshot_date')
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// Записать снапшот (вызывается из transactions.js при каждом изменении)
export async function writeSnapshot(gremlin_id, currency, balance) {
  const today = new Date().toISOString().split('T')[0]
  // Обновляем сегодняшний снапшот или создаём новый
  const { data: existing } = await supabase.from('balance_snapshots')
    .select('id').eq('gremlin_id', gremlin_id).eq('currency', currency).eq('snapshot_date', today).single()

  if (existing) {
    await supabase.from('balance_snapshots').update({ balance }).eq('id', existing.id)
  } else {
    await supabase.from('balance_snapshots').insert({ gremlin_id, currency, balance, snapshot_date: today })
  }
}

export default router
