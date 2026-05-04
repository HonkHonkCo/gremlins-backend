import { Router } from 'express'
import supabase from '../services/supabase.js'

const router = Router()

router.get('/', async (req, res) => {
  const { gremlin_id } = req.query
  if (!gremlin_id) return res.status(400).json({ error: 'gremlin_id required' })
  const { data, error } = await supabase.from('tasks').select('*').eq('gremlin_id', gremlin_id).order('deadline', { ascending: true, nullsFirst: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/', async (req, res) => {
  const { gremlin_id, title, description, deadline, priority, notify_before } = req.body
  if (!gremlin_id || !title) return res.status(400).json({ error: 'gremlin_id and title required' })

  const { data: task, error } = await supabase.from('tasks')
    .insert({ gremlin_id, title, description, deadline, priority: priority || 'medium', notify_before: notify_before || 1 })
    .select().single()
  if (error) return res.status(500).json({ error: error.message })

  const { data: gremlin } = await supabase.from('gremlins').select('stats').eq('id', gremlin_id).single()
  const stats = { ...(gremlin?.stats || {}) }
  stats.pending_tasks = (stats.pending_tasks || 0) + 1
  stats.last_task = title
  if (deadline) stats.next_deadline = deadline
  stats.last_updated = new Date().toISOString().split('T')[0]

  await supabase.from('gremlins').update({ stats, updated_at: new Date().toISOString() }).eq('id', gremlin_id)
  res.json({ task, stats })
})

router.patch('/:id', async (req, res) => {
  const { id } = req.params
  const { status } = req.body
  const { data: task } = await supabase.from('tasks').select('gremlin_id').eq('id', id).single()
  const { data, error } = await supabase.from('tasks').update({ status }).eq('id', id).select().single()
  if (error) return res.status(500).json({ error: error.message })

  if (status === 'done' && task?.gremlin_id) {
    const { data: gremlin } = await supabase.from('gremlins').select('stats').eq('id', task.gremlin_id).single()
    const stats = { ...(gremlin?.stats || {}) }
    stats.pending_tasks = Math.max(0, (stats.pending_tasks || 1) - 1)
    await supabase.from('gremlins').update({ stats }).eq('id', task.gremlin_id)
    return res.json({ task: data, stats })
  }
  res.json({ task: data })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params
  await supabase.from('tasks').delete().eq('id', id)
  res.json({ success: true })
})

export default router
