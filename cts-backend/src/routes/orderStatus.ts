import { Router, type Request, type Response, type NextFunction } from 'express'
import { randomUUID } from 'node:crypto'
import { recordAudit } from '../lib/audit.js'
import type { AuthedRequest } from '../middleware/requireAuth.js'

// ══════════════════════════════════════════════════════════════
// อัปเดตสถานะ order: builds the create-order-status-update payload from the form and posts it
// from the server. The endpoint is public (no token). Every send — who, from which IP, what was
// sent and what came back — goes into the audit log.
//   ORDER_STATUS_URL  (default https://cust-api.allnowgroup.com/api/create-order-status-update)
// ══════════════════════════════════════════════════════════════

const router = Router()
const URL_ = () => process.env.ORDER_STATUS_URL || 'https://cust-api.allnowgroup.com/api/create-order-status-update'
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// One Message ID goes with exactly one job, one order and one shipment, all required.
export const FIELDS = [
  ['messageId', 'Message ID'], ['jobNo', 'Job No'],
  ['orderNo', 'Order No'], ['orderTracking', 'Upstream Tracking No ของ Order'],
  ['shipmentNo', 'Shipment No'], ['shipmentTracking', 'Upstream Tracking No ของ Shipment'],
] as const

export function buildPayload(body: Record<string, unknown>) {
  const v = Object.fromEntries(FIELDS.map(([k]) => [k, str(body[k])])) as Record<(typeof FIELDS)[number][0], string>
  const missing = FIELDS.filter(([k]) => !v[k]).map(([, label]) => label)
  const errors = missing.length ? [`กรอกให้ครบ: ${missing.join(', ')}`] : []
  return {
    errors,
    payload: {
      code: null,
      items: {
        errorCreateJob: null, errorDirectScheduleOrders: null, errorOrders: null,
        jobNoSuccess: [v.jobNo],
        orderNoSuccess: [{ orderNo: v.orderNo, upstreamTrackingNumber: v.orderTracking }],
        shipmentNoSuccess: [{ shipmentNo: v.shipmentNo, upstreamTrackingNumber: v.shipmentTracking }],
        typeImport: 'CARRIER',
      },
      message: null,
      messageId: v.messageId,
    },
  }
}

const clientIp = (req: Request) => (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '')

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { errors, payload } = buildPayload(req.body ?? {})
    if (errors.length) { res.status(400).json({ message: errors.join(' · ') }); return }
    const user = (req as AuthedRequest).user
    const ip = clientIp(req)
    const requestId = randomUUID()
    const started = Date.now()
    let status = 0, body = '', error = ''
    try {
      const r = await fetch(URL_(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) })
      status = r.status
      body = (await r.text()).slice(0, 4000)
    } catch (e) {
      error = (e as Error)?.name === 'TimeoutError' ? 'ปลายทางไม่ตอบภายใน 20 วินาที' : `เชื่อมต่อปลายทางไม่ได้: ${(e as Error)?.message ?? ''}`
    }
    const ok = !error && status >= 200 && status < 300
    const ms = Date.now() - started
    const it = payload.items
    await recordAudit(user, {
      action: 'order.status.send',
      summary: `${ok ? 'ส่ง' : 'ส่งไม่สำเร็จ'} อัปเดตสถานะ order: messageId ${payload.messageId}, job ${it.jobNoSuccess[0]}, order ${it.orderNoSuccess[0].orderNo}, shipment ${it.shipmentNoSuccess[0].shipmentNo} จาก IP ${ip}${status ? ` · HTTP ${status}` : ''}`,
      success: ok,
      details: { ip, userAgent: String(req.get('user-agent') ?? '').slice(0, 300), requestId, url: URL_(), status, ms, error: error || undefined, text: `ส่ง:\n${JSON.stringify(payload, null, 2)}\n\nตอบกลับ (HTTP ${status || '-'}):\n${body || error}` },
    })
    res.status(ok ? 200 : 502).json({ ok, status, ms, response: body, error: error || undefined, ip, requestId })
  } catch (err) { next(err) }
})

export default router
