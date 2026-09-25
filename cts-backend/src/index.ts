import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'

import authRouter    from './routes/auth.js'
import uploadRouter  from './routes/upload.js'
import reportsRouter from './routes/reports.js'
import exportRouter  from './routes/export.js'
import healthRouter  from './routes/health.js'
import jiraRouter    from './routes/jira.js'
import { errorHandler } from './middleware/errorHandler.js'
import { requireAuth } from './middleware/requireAuth.js'

// ── App ───────────────────────────────────────────────────────
const app = express()
const PORT = Number(process.env.PORT ?? 4000)

// ── Security & logging ────────────────────────────────────────
app.use(helmet())
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))

// ── CORS ──────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())

const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: origin ${origin} not allowed`))
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}

app.options('*', cors(corsOptions))
app.use(cors(corsOptions))

// ── Body parsers ──────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Public routes (no auth required) ────────────────────────────
app.use('/api/health', healthRouter)
app.use('/api/auth',   authRouter)

// ── Protected routes (auth required) ────────────────────────────
app.use('/api/upload',  requireAuth, uploadRouter)
app.use('/api/reports', requireAuth, reportsRouter)
app.use('/api/export',  requireAuth, exportRouter)
app.use('/api/jira',    requireAuth, jiraRouter)

// ── 404 ───────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found' })
})

// ── Error handler (must be last) ──────────────────────────────
app.use(errorHandler)

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] running on http://localhost:${PORT}`)
  console.log(`[server] allowed origins: ${ALLOWED_ORIGINS.join(', ')}`)
  console.log(`[server] env: ${process.env.NODE_ENV ?? 'development'}`)
})

export default app
