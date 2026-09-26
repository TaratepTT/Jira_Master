// ══════════════════════════════════════════════════════════════
// เพิ่ม import นี้ในไฟล์ reports.ts (ต่อจาก import เดิมของ jira.js)
// ══════════════════════════════════════════════════════════════

import { fetchJiraComments, fetchJiraChangelog, addJiraComment } from '../lib/jira.js'


// ══════════════════════════════════════════════════════════════
// เพิ่ม 2 routes นี้ ต่อจาก PATCH /:id/tickets/:key (ก่อน DELETE)
// ══════════════════════════════════════════════════════════════

// ── GET /api/reports/:id/tickets/:key/activity ───────────────────
// ดึง Comments + Changelog มาพร้อมกัน แสดงใน Ticket Modal
router.get('/:id/tickets/:key/activity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, key } = req.params

    const ticket = await prisma.ticket.findFirst({ where: { reportId: id, key } })
    if (!ticket) {
      res.status(404).json({ message: 'ไม่พบ ticket นี้ใน report' })
      return
    }

    const [comments, changelog] = await Promise.all([
      fetchJiraComments(key),
      fetchJiraChangelog(key),
    ])

    res.json({ comments, changelog })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/reports/:id/tickets/:key/comment ────────────────────
// เพิ่ม comment ใหม่จาก Dashboard เข้า Jira โดยตรง
router.post('/:id/tickets/:key/comment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, key } = req.params
    const { text } = req.body as { text?: string }

    if (!text || !text.trim()) {
      res.status(400).json({ message: 'กรุณากรอกข้อความ comment' })
      return
    }

    const ticket = await prisma.ticket.findFirst({ where: { reportId: id, key } })
    if (!ticket) {
      res.status(404).json({ message: 'ไม่พบ ticket นี้ใน report' })
      return
    }

    await addJiraComment(key, text.trim())

    // Return the fresh comment list so the frontend can update immediately
    const comments = await fetchJiraComments(key)
    res.json({ message: 'เพิ่ม comment สำเร็จ', comments })
  } catch (err) {
    next(err)
  }
})
