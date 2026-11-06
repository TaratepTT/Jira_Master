# สถานะระบบ แจ้งเตือน และสำรองข้อมูล (E1 + E2)

หน้าใหม่: **ผู้ดูแลระบบ → สถานะระบบ** (`/admin/system`, เฉพาะ Admin) มี 3 แท็บ

| แท็บ | ใช้ทำอะไร |
|---|---|
| สถานะ | ดูว่าฐานข้อมูล, Jira, Confluence, ตัวดึง ticket, การกัน server หลับ, การสำรองข้อมูล และการแจ้งเตือน ยังปกติไหม กรอกวันหมดอายุ API token และกดส่งข้อความทดสอบ |
| สำรองข้อมูล | ดูชุดสำรอง สำรองทันที ดาวน์โหลด `.json.gz` กู้ report ที่หายไป และกู้คู่มือที่ถูกลบ |
| ถังขยะ | report ที่ถูกลบจะอยู่ที่นี่ 30 วัน กู้คืนได้ครบทั้ง ticket การแก้ไข และบทสรุป AI |

## Deploy

ครั้งนี้มีตารางใหม่ 2 ตาราง (`report_archives`, `backups`) จึงต้องรัน `db push` หนึ่งครั้ง

```powershell
cd D:\Jira_Master\cts-backend
npm install
npx prisma db push
npm run build
cd ..\cts-frontend
npm install
npm run build
cd ..
git add -A
git commit -m "System status, alerts, backups and report trash"
git push origin main
```

ถ้าไม่ตั้งค่าอะไรเพิ่ม ทุกอย่างทำงานได้เลย ยกเว้นการส่งแจ้งเตือนออกไปนอกแอป (ดูข้อ 2)

## 1. กัน Render หลับ

Render แผนฟรีจะหลับเมื่อไม่มีคนเข้าเว็บ 15 นาที ตัวดึง ticket จึงหยุดตาม ตอนนี้ server จะเรียก `/api/health` ของตัวเองทุก 10 นาที เพื่อไม่ให้หลับ

- บน Render ใช้ `RENDER_EXTERNAL_URL` ที่ Render ตั้งให้อยู่แล้ว ไม่ต้องตั้งอะไรเพิ่ม
- ชั่วโมงใช้งานฟรีของ Render (750 ชม./เดือน) พอสำหรับ service เดียวที่รันทั้งเดือน
- ถ้า server ล่มไปทั้งตัว (เช่น build พัง) server จะปลุกตัวเองไม่ได้ ถ้าอยากรู้ในกรณีนี้ด้วย ให้ตั้งตัวตรวจภายนอกฟรี เช่น UptimeRobot หรือ cron-job.org ให้เรียก `https://jira-master.onrender.com/api/health` ทุก 5 นาที แล้วแจ้งเตือนเข้าอีเมล

## 2. แจ้งเตือนเข้า Teams หรือ Slack

ตั้ง `ALERT_WEBHOOK_URL` บน Render (Environment) แอปดูจาก URL เองว่าเป็น Teams หรือ Slack

**Microsoft Teams:** ในช่อง (channel) ที่ต้องการ → `...` → **Workflows** → เลือก template **"Post to a channel when a webhook request is received"** → ทำตามขั้นตอนจนได้ URL → คัดลอก URL ไปใส่ใน Render

**Slack:** สร้าง Slack app → **Incoming Webhooks** → เปิดใช้ → **Add New Webhook to Workspace** → เลือกช่อง → คัดลอก URL `https://hooks.slack.com/...`

ตั้งแล้วกด **ส่งข้อความทดสอบ** ในหน้าสถานะระบบ

ระบบจะแจ้งเตือนเมื่อ
- ดึง ticket จาก Jira ไม่ได้ 3 รอบติดกัน (ประมาณ 15 นาที) หรือแจ้งทันทีถ้า Jira ตอบ 401/403 (token หมดอายุหรือถูกยกเลิก)
- ค้น Confluence ไม่ได้ 3 รอบติดกัน
- สำรองข้อมูลอัตโนมัติไม่สำเร็จ
- API token จะหมดอายุภายใน 7 วัน (ต้องกรอกวันหมดอายุในหน้าสถานะระบบก่อน ระบบเก็บแค่วันที่ ไม่เก็บ token)

แต่ละปัญหาแจ้งครั้งเดียว ไม่ส่งซ้ำทุกรอบ และส่งอีกครั้งเมื่อกลับมาปกติ

## 3. สำรองข้อมูลและกู้คืน

- **ลบ report:** report ย้ายไปถังขยะก่อน กู้คืนได้ 30 วัน หลังจากนั้นระบบลบให้เอง
- **สำรองอัตโนมัติทุก 7 วัน:** เก็บ 8 ชุดล่าสุด (ประมาณ 2 เดือน) ไว้ในฐานข้อมูล ในชุดสำรองมี report พร้อม ticket การแก้ไขและบทสรุป AI, คู่มือ, ประวัติการส่งคู่มือ, saved views, การตั้งค่า, รายชื่อผู้ใช้ และประวัติการใช้งาน
- **ไม่เก็บ:** รหัสผ่าน (hash), token ของ Jira ใดๆ และค่าใน Render env
- **กู้คืน:** เลือกชุดสำรอง → **กู้คืนจากชุดนี้** → กดกู้ report ที่ขึ้นว่าไม่มีในระบบแล้ว หรือกด **กู้คืนคู่มือที่หายไป** ระบบไม่เขียนทับข้อมูลที่ยังอยู่
- **เก็บนอกระบบ:** Supabase แผนฟรีไม่มี backup ให้ ถ้าฐานข้อมูลเสียทั้งก้อน ชุดสำรองในฐานข้อมูลจะหายไปด้วย ควรกด **ดาวน์โหลด** เก็บไว้ใน OneDrive หรือ Google Drive เดือนละครั้ง

ticket ต้นฉบับอยู่ใน Jira อยู่แล้ว ชุดสำรองนี้จึงเก็บเฉพาะข้อมูลที่มีแค่ในแอปนี้

## Environment variables (ไม่บังคับทั้งหมด)

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `ALERT_WEBHOOK_URL` | (ว่าง) | URL webhook ของ Teams หรือ Slack ถ้าไม่ตั้ง จะเห็นปัญหาได้แค่ในหน้าสถานะระบบ |
| `ALERT_APP_NAME` | `CTS Dashboard` | ชื่อที่แสดงในข้อความแจ้งเตือน |
| `KEEP_AWAKE` | (เปิด) | ตั้ง `off` เพื่อปิดการปลุกตัวเอง |
| `KEEP_AWAKE_URL` | `RENDER_EXTERNAL_URL` | URL ที่จะปลุก ถ้าไม่ได้รันบน Render |
| `KEEP_AWAKE_MS` | `600000` | ความถี่ในการปลุก (10 นาที) |
| `BACKUP` | (เปิด) | ตั้ง `off` เพื่อปิดการสำรองอัตโนมัติ |
| `BACKUP_EVERY_DAYS` | `7` | สำรองทุกกี่วัน |
| `BACKUP_KEEP` | `8` | เก็บกี่ชุดล่าสุด |
| `ARCHIVE_DAYS` | `30` | เก็บ report ในถังขยะกี่วัน |
| `APP_TIMEZONE` | `Asia/Bangkok` | ใช้นับวันที่เหลือของ token |

## Files

- Backend: `src/lib/alerts.ts`, `src/lib/system.ts`, `src/lib/backup.ts`, `src/routes/system.ts`, plus edits to `index.ts`, `reports.ts`, `watcher.ts`, `playbooks.ts`, `prisma/schema.prisma`
- Frontend: `app/admin/system/page.tsx`, plus edits to `lib/api.ts`, `AppShell.tsx` (nav), `CommandPalette.tsx`, the report delete confirms (`app/page.tsx`, `app/history/page.tsx`, `RecentReports.tsx`) and `app/admin/audit/page.tsx`

## ลบ ticket ออกจาก report (Admin)

ในแท็บ ticket ของ Dashboard ให้ติ๊กช่องท้ายแถว (เลือกได้หลายใบ) แล้วกด **ลบออกจาก report N ใบ** ในแถบ "ที่เลือกไว้" ด้านบนตาราง

- ticket จะหายจาก report นี้เท่านั้น และไม่ถูกนับในภาพรวม, SLA และแนวโน้ม ข้อมูลใน Jira ไม่ถูกแตะ
- กด **เลิกทำ** ใน toast ได้ทันทีหลังลบ หรือกู้คืนภายหลังจากรายการ **ticket ที่ลบออกจาก report นี้** ใต้ตาราง (ทีละใบหรือทั้งหมด)
- **รีเฟรชจาก Jira** อัปเดตเฉพาะ ticket ที่ยังอยู่ใน report ใบที่ลบไว้จะไม่กลับมาเอง
- บันทึกในประวัติการใช้งานทุกครั้ง และอยู่ในข้อมูลสำรองด้วย
- ไม่ต้องรัน `prisma db push` สำหรับส่วนนี้
