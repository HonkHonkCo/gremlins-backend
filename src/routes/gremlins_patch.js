// Добавь оба роута в gremlins.js ПЕРЕД router.delete

// GET /gremlins/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params
  const { data, error } = await supabase
    .from('gremlins').select('*').eq('id', id).single()
  if (error) return res.status(404).json({ error: 'Gremlin not found' })
  res.json(data)
})

// PATCH /gremlins/:id — принимает name, description, stats
router.patch('/:id', async (req, res) => {
  const { id } = req.params
  const { name, description, stats } = req.body
  const updates = {}
  if (name !== undefined) updates.name = name
  if (description !== undefined) updates.description = description
  if (stats !== undefined) updates.stats = stats  // <- сброс/обновление stats
  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('gremlins').update(updates).eq('id', id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})
