'use client'

import { useMemo, useState } from 'react'
import AppShell, { PageHeader } from '@/components/layout/AppShell'
import { useDialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { sendOrderStatus, type OrderStatusInput, type OrderStatusResult } from '@/lib/api'

// อัปเดตสถานะ order — one Message ID with one job, one order and one shipment, all required.
// The server sends it and records who sent it and from which IP. typeImport is always CARRIER.

type Key = keyof OrderStatusInput
const FIELDS: { key: Key; label: string; placeholder: string; group?: string }[] = [
  { key: 'messageId', label: 'Message ID', placeholder: '8bea5fa5-8485-4101-a7d7-693df3bb4193' },
  { key: 'jobNo', label: 'Job No', placeholder: 'R002302230447' },
  { key: 'orderNo', label: 'Order No', placeholder: 'O002310154286', group: 'Order' },
  { key: 'orderTracking', label: 'Upstream Tracking No', placeholder: '595911_LT-006579', group: 'Order' },
  { key: 'shipmentNo', label: 'Shipment No', placeholder: 'D002310154286T1', group: 'Shipment' },
  { key: 'shipmentTracking', label: 'Upstream Tracking No', placeholder: '595911_LT-006579', group: 'Shipment' },
]
const EMPTY: OrderStatusInput = { messageId: '', jobNo: '', orderNo: '', orderTracking: '', shipmentNo: '', shipmentTracking: '' }
const errMsg = (e: unknown) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'ส่งไม่สำเร็จ ลองใหม่อีกครั้ง'

export default function OrderStatusPage() {
  const [v, setV] = useState<OrderStatusInput>(EMPTY)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<OrderStatusResult | null>(null)
  const { confirm, notify } = useDialog()
  const toast = useToast()

  const t = useMemo(() => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()])) as OrderStatusInput, [v])
  const payload = useMemo(() => ({
    code: null,
    items: {
      errorCreateJob: null, errorDirectScheduleOrders: null, errorOrders: null,
      jobNoSuccess: [t.jobNo],
      orderNoSuccess: [{ orderNo: t.orderNo, upstreamTrackingNumber: t.orderTracking }],
      shipmentNoSuccess: [{ shipmentNo: t.shipmentNo, upstreamTrackingNumber: t.shipmentTracking }],
      typeImport: 'CARRIER',
    },
    message: null,
    messageId: t.messageId,
  }), [t])
  const missing = FIELDS.filter(f => !t[f.key]).map(f => (f.group ? `${f.label} (${f.group})` : f.label))

  const send = async () => {
    if (missing.length) { await notify({ title: 'ข้อมูลยังไม่ครบ', message: `กรอกให้ครบ: ${missing.join(', ')}`, tone: 'danger' }); return }
    if (!(await confirm({
      title: 'ส่งอัปเดตสถานะ order?',
      message: 'ข้อมูลจะถูกส่งไปที่ระบบปลายทางทันที และบันทึกชื่อผู้ส่งกับ IP ไว้ในประวัติการใช้งาน',
      detail: <span className="font-mono text-[12.5px] leading-relaxed">Message ID {t.messageId}<br />Job {t.jobNo}<br />Order {t.orderNo} · {t.orderTracking}<br />Shipment {t.shipmentNo} · {t.shipmentTracking}</span>,
      confirmLabel: 'ส่ง',
    }))) return
    setSending(true); setResult(null)
    try {
      const r = await sendOrderStatus(t)
      setResult(r)
      toast.show(r.ok ? { text: `ส่งสำเร็จ (HTTP ${r.status})`, tone: 'ok' } : { text: 'ปลายทางตอบว่าไม่สำเร็จ ดูรายละเอียดด้านขวา', tone: 'danger' })
    } catch (e) {
      await notify({ title: 'ส่งไม่สำเร็จ', message: errMsg(e), tone: 'danger' })
    } finally { setSending(false) }
  }

  const input = (f: (typeof FIELDS)[number]) => (
    <div key={f.key}>
      <label htmlFor={`os-${f.key}`} className="mb-1 block text-[13px] text-ink">{f.label} <span className="text-danger">*</span></label>
      <input id={`os-${f.key}`} className="field w-full font-mono" placeholder={f.placeholder} value={v[f.key]}
        onChange={e => setV(p => ({ ...p, [f.key]: e.target.value }))} autoComplete="off" spellCheck={false} />
    </div>
  )

  return (
    <AppShell>
      <PageHeader title="อัปเดตสถานะ order" description="1 Message ID ต่อ 1 Job, 1 Order และ 1 Shipment กรอกครบทุกช่องแล้วกดส่ง ระบบบันทึกว่าใครส่งจาก IP ไหน (typeImport = CARRIER)" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="panel panel-pad space-y-5">
          {input(FIELDS[0])}
          {input(FIELDS[1])}
          {(['Order', 'Shipment'] as const).map(g => (
            <fieldset key={g} className="rounded-md border border-line p-3">
              <legend className="px-1 text-[13.5px] font-medium text-ink">{g}</legend>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">{FIELDS.filter(f => f.group === g).map(input)}</div>
            </fieldset>
          ))}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <button className="btn-primary" onClick={send} disabled={sending} aria-busy={sending}>{sending ? 'กำลังส่ง...' : 'ส่งอัปเดต'}</button>
            <button className="btn" onClick={() => { setV(EMPTY); setResult(null) }} disabled={sending}>ล้างฟอร์ม</button>
            {missing.length > 0 && <span className="text-[12.5px] text-muted">ยังไม่ได้กรอก {missing.length} ช่อง</span>}
          </div>
        </div>
        <div className="space-y-6">
          <section className="panel panel-pad">
            <h2 className="section-title mb-2">payload ที่จะส่ง</h2>
            <pre className="max-h-[420px] overflow-auto rounded-md bg-sunken p-3 text-[12px] leading-relaxed" data-testid="os-preview">{JSON.stringify(payload, null, 2)}</pre>
          </section>
          {result && (
            <section className={`panel panel-pad ${result.ok ? '' : 'border-danger/40'}`} data-testid="os-result" aria-live="polite">
              <h2 className={`section-title ${result.ok ? 'text-ok' : 'text-danger'}`}>{result.ok ? 'ส่งสำเร็จ' : 'ไม่สำเร็จ'}{result.status ? ` · HTTP ${result.status}` : ''} <span className="font-normal text-muted num">({result.ms} ms)</span></h2>
              {result.error && <p className="mt-1 text-[13px] text-danger">{result.error}</p>}
              <pre className="mt-2 max-h-[300px] overflow-auto rounded-md bg-sunken p-3 text-[12px]">{result.response || '(ไม่มีข้อความตอบกลับ)'}</pre>
              <p className="mt-2 text-[12px] text-faint num">บันทึกในประวัติการใช้งานแล้ว · IP {result.ip} · อ้างอิง {result.requestId}</p>
            </section>
          )}
        </div>
      </div>
    </AppShell>
  )
}
