require('dotenv').config()
const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

// Routes
app.use('/api/users',    require('./routes/users'))
app.use('/api/gremlins', require('./routes/gremlins'))
app.use('/api/entries',  require('./routes/entries'))

// Health check
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date() }))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Gremlins backend running on port ${PORT}`))
