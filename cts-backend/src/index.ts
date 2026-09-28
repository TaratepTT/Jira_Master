import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import compression from 'compression'
import rateLimit from 'express-rate-limit'

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

// Render (and most hosts) sit behind a reverse proxy — needed so rate limiting
// sees the real client IP instead of the proxy's.
app.set('trust proxy', 1)

// ── Security & logging ────────────────────────────────────────
app.use(helmet())
// gzip JSON responses (ticket lists with long Root Cause / Resolution text shrink a lot)
app.use(compression())
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
// "Confirm sync" posts every selected ticket (incl. long Root Cause / Resolution text)
// in one request, which can be many MB — far above the 1 MB default. Give ONLY that
// route a bigger limit, and check the login token BEFORE reading the body so an
// anonymous client can't make the server buffer huge payloads. (Must come before the
// global parser below, which skips bodies that were already parsed.)
app.use('/api/jira/confirm', requireAuth, express.json({ limit: '25mb' }))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Rate limiting ─────────────────────────────────────────────
// Login: strict, to stop password guessing. Only FAILED attempts count, so a team
// sharing one office IP is not locked out by each other's successful logins.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'พยายามเข้าสู่ระบบมากเกินไป กรุณารอ 15 นาทีแล้วลองใหม่' },
})
// Everything else under /api: generous, just a safety net against runaway clients.
// Default 600/min per IP (a whole office often shares one IP); override with API_RATE_LIMIT_PER_MIN.
const API_LIMIT = Number.parseInt(process.env.API_RATE_LIMIT_PER_MIN ?? '', 10) || 600
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: API_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || req.path === '/health',
  message: { message: 'มีการเรียกใช้งานถี่เกินไป กรุณารอสักครู่' },
})
app.use('/api', apiLimiter)
app.use('/api/auth/login', loginLimiter)

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
