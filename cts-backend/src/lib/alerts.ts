import axios from 'axios'

// ══════════════════════════════════════════════════════════════
// E1 — tell the team when something breaks, and when it is fixed.
//   ALERT_WEBHOOK_URL  Slack incoming webhook (hooks.slack.com/...) or a Microsoft Teams
//                      Workflows / incoming webhook URL. Without it, alerts only show in the app.
// A source (jira, confluence, backup, keepawake, …) alerts after 3 failures in a row (or at once
// when `immediate`), then stays quiet until it works again and sends one "back to normal" message.
// ══════════════════════════════════════════════════════════════

export interface AlertState { source: string; failing: boolean; failures: number; lastError: string | null; since: string | null; notified: boolean }

const states = new Map<string, AlertState>()
const history: Array<{ at: string; source: string; text: string; ok: boolean; delivered: boolean }> = []

export const alertConfigured = () => !!process.env.ALERT_WEBHOOK_URL
const appName = () => process.env.ALERT_APP_NAME ?? 'CTS Dashboard'

export async function sendAlert(text: string): Promise<{ ok: boolean; message: string }> {
  const url = process.env.ALERT_WEBHOOK_URL
  if (!url) return { ok: false, message: 'ยังไม่ได้ตั้ง ALERT_WEBHOOK_URL' }
  const full = `${appName()}: ${text}`
  // Slack takes {text}; Teams (Workflows / connectors) takes a message with an Adaptive Card
  const body = /hooks\.slack\.com/.test(url)
    ? { text: full }
    : {
        type: 'message', text: full,
        attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { type: 'AdaptiveCard', version: '1.4', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', body: [{ type: 'TextBlock', text: full, wrap: true }] } }],
      }
  try {
    const r = await axios.post(url, body, { timeout: 10_000, validateStatus: () => true })
    return r.status < 300 ? { ok: true, message: 'ส่งแล้ว' } : { ok: false, message: `ปลายทางตอบ HTTP ${r.status}` }
  } catch (err) {
    return { ok: false, message: `ส่งไม่สำเร็จ (${(err as { code?: string }).code ?? 'network'})` }
  }
}

async function deliver(source: string, text: string, ok: boolean) {
  const r = alertConfigured() ? await sendAlert(text) : { ok: false, message: 'not configured' }
  history.unshift({ at: new Date().toISOString(), source, text, ok, delivered: r.ok })
  history.splice(30)
}

export const alert = {
  async report(source: string, ok: boolean, error?: string, opts: { immediate?: boolean; threshold?: number } = {}) {
    const s = states.get(source) ?? { source, failing: false, failures: 0, lastError: null, since: null, notified: false }
    if (ok) {
      if (s.notified) await deliver(source, `กลับมาใช้งานได้แล้ว (${label(source)})`, true)
      states.set(source, { source, failing: false, failures: 0, lastError: null, since: null, notified: false })
      return
    }
    s.failures++
    s.failing = true
    s.lastError = error ?? 'ไม่ทราบสาเหตุ'
    s.since = s.since ?? new Date().toISOString()
    if (!s.notified && (opts.immediate || s.failures >= (opts.threshold ?? 3))) {
      s.notified = true
      await deliver(source, `${label(source)} มีปัญหา: ${s.lastError}`, false)
    }
    states.set(source, s)
  },
  states: () => [...states.values()],
  history: () => history.slice(),
}

function label(source: string): string {
  return ({ jira: 'การดึง ticket จาก Jira', confluence: 'การค้น Confluence', backup: 'การสำรองข้อมูล', keepawake: 'การปลุก server', token: 'API token' } as Record<string, string>)[source] ?? source
}
