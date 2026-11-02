# CTS Dashboard — ชุดปรับปรุง 9 ข้อ (2 พ.ย. 2569)

## วิธีติดตั้ง

1. แตก zip แล้ว **วางทับที่ root ของ repo `Jira_Master/`** (path ใน zip ตรงกับใน repo)
   - ไฟล์ที่มีอยู่แล้ว = **วางทับ**
   - ไฟล์ใหม่ = สร้างตาม path (ดูรายการด้านล่าง)
   - **ไม่ต้องลบไฟล์ไหน**
2. **ต้องรัน `npx prisma db push`** ในโฟลเดอร์ `cts-backend` (ชี้ไปที่ Supabase) **ก่อน** push code
   - schema เพิ่มคอลัมน์ `reports.refreshed_at`, `tickets.resolved_at`, index ใหม่ และตาราง `jira_connections`
   - ถ้าลืม: หน้า Dashboard ยังเปิดได้ แต่รีเฟรชจาก Jira / เชื่อมบัญชี Jira จะ error
3. Commit + push → Render และ Vercel deploy เอง
4. (ไม่บังคับ) ตั้งค่า "เชื่อมบัญชี Jira รายคน" ตามหัวข้อ 7 — ถ้ายังไม่ตั้ง ระบบใช้ token กลางเหมือนเดิมทุกอย่าง

## ไฟล์ในชุดนี้

**Backend (`cts-backend/`)**
| ไฟล์ | สถานะ |
|---|---|
| `prisma/schema.prisma` | วางทับ |
| `src/index.ts` | วางทับ |
| `src/lib/jira.ts` | วางทับ |
| `src/routes/jira.ts` | วางทับ |
| `src/routes/reports.ts` | วางทับ |
| `src/routes/export.ts` | วางทับ |
| `src/lib/carryover.ts` | **ใหม่** |
| `src/lib/jiraContext.ts` | **ใหม่** |
| `src/lib/jiraOAuth.ts` | **ใหม่** |
| `src/middleware/jiraUser.ts` | **ใหม่** |
| `src/routes/jiraOAuth.ts` | **ใหม่** |

**Frontend (`cts-frontend/`)**
| ไฟล์ | สถานะ |
|---|---|
| `app/dashboard/[id]/page.tsx` | วางทับ (เหลือ ~900 บรรทัด จาก ~1,900) |
| `app/jira/validate/page.tsx` | วางทับ |
| `app/account/page.tsx` | วางทับ |
| `lib/api.ts` | วางทับ |
| `app/dashboard/[id]/summary/page.tsx` | **ใหม่** |
| `app/account/jira-callback/page.tsx` | **ใหม่** |
| `lib/useUrlFilters.ts` | **ใหม่** |
| `components/auth/JiraConnectionCard.tsx` | **ใหม่** |
| `components/dashboard/TicketDetailModal.tsx` | **ใหม่** (ย้ายออกจาก page.tsx) |
| `components/dashboard/TicketActivityPanel.tsx` | **ใหม่** (ย้ายออกจาก page.tsx) |
| `components/dashboard/AgingPanel.tsx` | **ใหม่** |
| `components/dashboard/FlowPanel.tsx` | **ใหม่** |
| `components/dashboard/FilteredInsights.tsx` | **ใหม่** (ย้ายออกจาก page.tsx) |
| `components/dashboard/MultiSelectFilter.tsx` | **ใหม่** (ย้ายออกจาก page.tsx) |
| `components/dashboard/SortableHeader.tsx` | **ใหม่** (ย้ายออกจาก page.tsx) |
| `components/dashboard/ProgressBar.tsx` | **ใหม่** (ย้ายออกจาก page.tsx) |
| `components/dashboard/types.ts` | **ใหม่** |
| `components/dashboard/utils.ts` | **ใหม่** |

**Root**
| ไฟล์ | สถานะ |
|---|---|
| `.github/workflows/ci.yml` | **ใหม่** — ตรวจ build อัตโนมัติทุกครั้งที่ push |

---

## สิ่งที่ได้ในแต่ละข้อ

### 1. เติมค่าจาก report สัปดาห์ก่อน (หน้า Validate)
- ตอน sync ถ้า Jira ยังว่าง (BU / Type of Issue / Root Cause / Resolution / Deploy Date) แต่ ticket เดียวกันเคยกรอกไว้ใน report ก่อน ระบบจะเสนอค่าล่าสุดให้
- แถบสีม่วง "เติมจาก report ก่อนหน้าทั้งหมด" หรือกดปุ่ม **↺** ข้าง Key เพื่อเลือกทีละช่อง
- ticket ที่กลายเป็น "ผ่าน" เพราะเติมค่า จะถูกติ๊กเลือกให้อัตโนมัติ
- ค่าที่เติมจะบันทึกลง report ใหม่ **ไม่ได้เขียนกลับเข้า Jira** (เหมือนการแก้ในหน้า Validate แบบเดิม)

### 2. ไล่กรอกข้อมูลที่ยังไม่ครบ
- แถบสีเหลืองบน Dashboard บอกว่ามีกี่ ticket ที่ BU / Type of Issue / Root Cause / Resolution ยังว่าง
- **"เริ่มไล่กรอกทีละใบ"** → เปิดใบแรกในโหมดแก้ไขทันที มีตัวนับ (เช่น 3 / 12)
- ปุ่ม **"บันทึกแล้วไปใบถัดไป"** (หรือ Ctrl/⌘ + Enter) ถ้า Jira มีคำเตือน ระบบจะหยุดที่ใบนั้นให้อ่านก่อน
- ปุ่ม ‹ › บนหัว modal และคีย์ลัด **← / →** ใช้ได้กับตารางทั้งหมด ไม่ใช่แค่คิว · **Esc** = ปิด / ออกจากโหมดแก้ไข
- ปุ่มกรอง "ข้อมูลยังไม่ครบ (N)" อยู่ในแถบตัวกรองด้วย

### 3. รีเฟรชจาก Jira (ไม่ต้องสร้าง report ใหม่)
- ปุ่ม **"รีเฟรชจาก Jira"** บนหัว Dashboard (editor/admin)
- ดึง **สถานะ, ผู้รับผิดชอบ, priority, วันที่ resolve** ล่าสุดจาก Jira เสมอ
- BU / Type / Root Cause / Resolution / Deploy Date: **เติมเฉพาะช่องที่ใน report ยังว่าง** ค่าที่คุณพิมพ์ไว้จะไม่ถูกทับ
- ticket ที่ถูกลบหรือย้ายใน Jira จะแจ้งชื่อไว้ และไม่ถูกแตะ
- หัวหน้า Dashboard แสดงเวลาที่รีเฟรชล่าสุด
- **แก้ปัญหา "(ปัจจุบัน)" ที่ผิด:** modal แก้ไขจะใช้ **สถานะสดจาก Jira** เป็นค่าปัจจุบันใน dropdown และถ้าไม่ตรงกับ report จะแจ้งไว้ใต้ช่อง Status

### 4. ตัวกรองติดไปกับลิงก์
- ตัวกรอง BU / Status / System / Category / ข้อมูลไม่ครบ, คำค้น, การเรียงลำดับ และ ticket ที่เปิดอยู่ อยู่ใน URL ทั้งหมด
- ปุ่ม **"คัดลอกลิงก์มุมมองนี้"** ส่งให้ทีมแล้วเปิดเห็นแบบเดียวกัน · กด refresh หน้าแล้วตัวกรองไม่หาย

### 5. Aging + Created vs Resolved + เวลาที่ใช้แก้
- **Aging:** ticket ที่ยังเปิดแยกตามอายุ 0–3 / 4–7 / 8–14 / 15–30 / 30+ วัน, รายการค้างนานสุด (คลิกเปิดได้), ตาราง BU × อายุ
  - นับถึงวันที่ข้อมูลของ report (วันรีเฟรชล่าสุด หรือวันที่ sync) · ไม่นับ Closed / Done / Resolved / Cancel
- **Created vs Resolved รายสัปดาห์** (กราฟ / ตาราง) + **เวลาแก้มัธยฐาน และ 90%** แยกตาม Type of Issue
- ระบบเริ่มเก็บ `resolutiondate` ของ Jira แล้ว · **report เก่า** ให้กด "รีเฟรชจาก Jira" หนึ่งครั้งเพื่อดึงวันที่ resolve มา

### 6. สรุปหนึ่งหน้าสำหรับประชุม
- ปุ่ม **"สรุปสำหรับประชุม"** → `/dashboard/<id>/summary`
- มี KPI พร้อมลูกศรเทียบ report ก่อนหน้า (เลือก report ที่จะเทียบได้), ประเด็นสำคัญที่สรุปให้อัตโนมัติ, Status / BU / Type of Issue, ticket ค้างนานสุด, L3, สถานะที่เปลี่ยน และ AI Root Cause (ถ้าเคยกดสรุปไว้)
- ปุ่ม **"พิมพ์ / บันทึกเป็น PDF"** ออกแบบไว้ให้พอดี A4 หนึ่งหน้า

### 7. เชื่อมบัญชี Jira รายคน (OAuth) — ต้องตั้งค่าเพิ่ม
เมื่อผู้ใช้กด **"เชื่อมบัญชี Jira"** ในหน้า "บัญชีของฉัน" ทุกการแก้ไข / เปลี่ยนสถานะ / comment จะ
- ขึ้นใน Jira เป็น **ชื่อของคนนั้น** (comment จะไม่มีบรรทัดลงชื่อ "ผ่าน CTS Dashboard" แล้ว)
- ใช้ **สิทธิ์ workflow ของบัญชีคนนั้น** → แก้ปัญหา dropdown เหลือตัวเลือกเดียวอย่าง CTS-17110 ได้ ถ้าบัญชีคนนั้นมีสิทธิ์

คนที่ยังไม่เชื่อม ใช้ token กลางเหมือนเดิม · modal แก้ไขจะบอกว่ากำลังบันทึก "ในชื่อใคร"

**ขั้นตอนตั้งค่า** (ทำครั้งเดียว อาจต้องให้ Jira/Atlassian admin ช่วย)
1. เข้า https://developer.atlassian.com/console/myapps → **Create → OAuth 2.0 integration**
2. **Permissions** → Jira API → เพิ่ม scope: `read:jira-work`, `write:jira-work`, `read:jira-user`
3. **Authorization** → Callback URL: `https://jira-master-umber.vercel.app/account/jira-callback`
4. **Distribution** → ตั้งเป็น **Sharing** ถ้าคนอื่นนอกจากเจ้าของแอปต้องใช้ด้วย (ตามเอกสารของ Atlassian ต้องกรอกข้อมูลผู้พัฒนาและนโยบายข้อมูลส่วนบุคคลก่อน)
5. **Settings** → คัดลอก Client ID และ Secret
6. ใส่ env บน **Render**:
   ```
   ATLASSIAN_CLIENT_ID=<client id>
   ATLASSIAN_CLIENT_SECRET=<secret>
   ATLASSIAN_REDIRECT_URI=https://jira-master-umber.vercel.app/account/jira-callback
   JIRA_TOKEN_ENC_KEY=<สุ่มข้อความยาว ๆ 32+ ตัวอักษร — ใช้เข้ารหัส token ที่เก็บในฐานข้อมูล>
   ```
   ถ้าเปลี่ยน `JIRA_TOKEN_ENC_KEY` ภายหลัง ทุกคนต้องกดเชื่อมต่อใหม่
7. ถ้า Jira site ตั้งให้ admin ต้องอนุมัติแอปภายนอก ให้ admin อนุมัติแอปนี้

ด้านความปลอดภัย:
- token เก็บแบบเข้ารหัส (AES-256-GCM)
- ขั้นตอนเชื่อมต่อตรวจว่าคนที่กดเริ่มกับคนที่กดยืนยันเป็นบัญชี Dashboard เดียวกัน (กันการแอบผูกบัญชี Jira ของคนอื่น)
- ต่ออายุ token อัตโนมัติ ถ้า token ถูกยกเลิก ระบบจะกลับไปใช้ token กลางและแจ้งให้เชื่อมต่อใหม่
- ทุกการแก้ไขใน Audit log บันทึกว่าใช้บัญชีไหน (`jiraAs`)

### 8. แตกไฟล์ + CI
- `dashboard/[id]/page.tsx` เหลือแค่ส่วนประกอบหน้า ส่วนย่อยย้ายไป `components/dashboard/*`
- ลิงก์ Jira ใช้ค่ากลาง (ตั้ง `NEXT_PUBLIC_JIRA_BASE_URL` บน Vercel ได้ถ้าเปลี่ยน site — ไม่ตั้งก็ใช้ค่าเดิม)
- `.github/workflows/ci.yml`: ทุกครั้งที่ push GitHub จะ build backend + frontend ให้ ถ้าพังจะเห็นใน tab **Actions** ก่อน deploy

### 9. แถม
- ดาวน์โหลดไฟล์แนบ: ตรวจว่าไฟล์เป็นของ ticket นั้นจริง (เดิมผู้ใช้ที่ login แล้วขอไฟล์แนบอะไรก็ได้ใน Jira ถ้ารู้ id)
- Export CSV: เพิ่มคอลัมน์ Assignee, Priority, Created, Resolved

---

## ทดสอบแล้ว (ในสภาพแวดล้อมจำลอง)
- Backend: TypeScript strict ผ่าน, `prisma validate` ผ่าน, API test 40 ข้อ ผ่าน
  - ใช้ Jira/Atlassian จำลอง และฐานข้อมูลจำลองในหน่วยความจำ
  - ครอบคลุม carry-over, refresh, live status, OAuth ครบวงจร, สิทธิ์ viewer, การต่ออายุ token พร้อมกัน 5 คำขอ (ต่ออายุครั้งเดียว), token ถูกยกเลิก, การเข้ารหัส
- Frontend: `next build` ผ่าน, ทดสอบผ่าน browser จริงทั้งโหมดสว่าง / มืด / มือถือ
  - คิวไล่กรอก, คีย์ลัด, ลิงก์ตัวกรอง, รีเฟรช, หน้าสรุป (พิมพ์เป็น PDF ได้ 1 หน้า), carry-over, การเชื่อมบัญชี

**ยังไม่ได้ทดสอบกับของจริง:** Jira/Atlassian จริง, Supabase จริง
- endpoint `/issue/bulkfetch` ของ Jira จริง (ถ้าไม่รองรับ ระบบจะสลับไปใช้ JQL ให้อัตโนมัติ)
- การตั้งค่า Atlassian OAuth app จริง
