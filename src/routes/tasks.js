import { Router } from 'express'
import supabase from '../services/supabase.js'

const router = Router()

// Пересчитывает stats секретаря из актуального списка задач
async function recalcSecretaryStats(gremlin_id) {
  const { data: allTasks } = await supabase
    .from('tasks').select('*')
    .eq('gremlin_id', gremlin_id)
    .eq('status', 'pending')
    .order('deadline', { ascending: true, nullsFirst: false })

  const pending = (allTasks || []).filter(t => !t.repeat)
  const today = new Date().toISOString().split('T')[0]

  // Топ-3 ближайших задачи для статуса на главном экране
  const next_tasks = pending.slice(0, 3).map(t => ({
    title: t.title,
    deadline: t.deadline || null,
    priority: t.priority || 'medium',
  }))

  const { data: gremlin } = await supabase.from('gremlins').select('stats').eq('id', gremlin_id).single()
  const stats = { ...(gremlin?.stats || {}) }

  stats.pending_tasks = pending.length
  stats.next_tasks = next_tasks
  stats.next_deadline = pending.find(t => t.deadline)?.deadline || null
  stats.next_task_title = pending[0]?.title || null
  stats.last_updated = today

  await supabase.from('gremlins').update({ stats, updated_at: new Date().toISOString() }).eq('id', gremlin_id)
  return stats
}

router.get('/', async (req, res) => {
  const { gremlin_id } = req.query
  if (!gremlin_id) return res.status(400).json({ error: 'gremlin_id required' })
  const { data, error } = await supabase
    .from('tasks').select('*').eq('gremlin_id', gremlin_id)
    .order('deadline', { ascending: true, nullsFirst: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/', async (req, res) => {
  const { gremlin_id, title, description, deadline, priority, notify_before, repeat } = req.body
  if (!gremlin_id || !title) return res.status(400).json({ error: 'gremlin_id and title required' })

  const { data: task, error } = await supabase.from('tasks')
    .insert({
      gremlin_id, title, description,
      deadline: deadline || null,
      priority: priority || 'medium',
      notify_before: notify_before || 1,
      repeat: repeat || null,
    })
    .select().single()
  if (error) return res.status(500).json({ error: error.message })

  const stats = await recalcSecretaryStats(gremlin_id)
  res.json({ task, stats })
})

router.patch('/:id', async (req, res) => {
  const { id } = req.params
  const { status } = req.body
  const { data: task } = await supabase.from('tasks').select('*').eq('id', id).single()
  const { data, error } = await supabase.from('tasks').update({ status }).eq('id', id).select().single()
  if (error) return res.status(500).json({ error: error.message })

  if (task?.gremlin_id) {
    const stats = await recalcSecretaryStats(task.gremlin_id)
    return res.json({ task: data, stats })
  }
  res.json({ task: data })
})

router.delete('/:id', async (req, res) => {
  const { id } = req.params
  const { data: task } = await supabase.from('tasks').select('gremlin_id').eq('id', id).single()
  await supabase.from('tasks').delete().eq('id', id)

  if (task?.gremlin_id) {
    const stats = await recalcSecretaryStats(task.gremlin_id)
    return res.json({ success: true, stats })
  }
  res.json({ success: true })
})

export default router

