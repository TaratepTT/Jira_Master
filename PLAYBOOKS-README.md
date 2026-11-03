# คู่มือ L1 (Playbooks): ส่งคู่มือให้ L1 อัตโนมัติเมื่อมี ticket ใหม่

When someone opens a new ticket in project CTS, the system finds a matching manual and adds an
**internal comment** to the ticket. The comment holds the short steps, the Confluence link and similar
solved tickets. L1 reads it and does the work without escalating. Customers on the JSM portal
**do not see** this comment: it is sent with the `sd.public.comment = internal` property.

## How it works (no Jira admin needed)

1. **The system pulls new tickets from Jira itself.** Every 5 minutes it uses the shared API token to fetch tickets created in CTS since its last run. If the server was asleep, it looks back up to 24 hours.
2. **It reads each whole ticket**: summary, description, Type of Issue and system.
3. **It looks for a match**:
   - First it checks the playbooks written in the app (keywords).
   - It also searches Confluence for up to 10 candidate pages, then **opens the full text of the top 5 pages** and compares them with the ticket:
     - Is the page title close to the summary?
     - How many of the ticket's words appear in the page?
     - Do word pairs from the summary (e.g. "import excel") appear in the page too?
     - Does an error message from the description (e.g. "Template version mismatch") appear in the page word for word? This scores heavily.
4. **It decides**:
   - Playbook set to auto-send and scoring 60%+ → posts the playbook.
   - Otherwise, Confluence auto-send is on and a page passes the threshold → posts the links.
   - Otherwise → it only records the result, nothing is posted.
5. **It records every ticket** in the "ticket ใหม่ที่ระบบตรวจแล้ว" list on the คู่มือ L1 page. The list shows what each ticket matched, the score and the reasons, and has buttons to send by hand ("ส่งให้ L1") and to check again ("ตรวจใหม่").
6. **It never sends twice**, and it does not go back to tickets it has already checked. "ตรวจใหม่" only looks, it never sends.

> **Render free plan**: the server sleeps after 15 minutes without traffic, and the watcher pauses with it.
> When anyone opens the app, the server wakes up and catches up on everything (up to 24 hours back). If you want comments to arrive within 5 minutes all the time:
> - Ping the server to keep it awake: create a free job at https://cron-job.org that calls `https://jira-master.onrender.com/api/health` every 10 minutes, or
> - Upgrade Render to Starter, or
> - Add the Jira Automation webhook below, which makes it instant.

## Deploy

```powershell
cd D:\Jira_Master
# extract the zip over the repo, then
cd cts-backend
npm install
npx prisma db push        # creates playbooks, playbook_deliveries, ticket_checks
npm run build
cd ..\cts-frontend
npm install
npm run build
cd ..
git add -A
git commit -m "Auto-assist: pull new tickets from Jira and recheck Confluence pages"
git push origin main
```

### Environment variables on Render (backend)

| Variable | Value | Notes |
|---|---|---|
| `FRONTEND_URL` | `https://jira-master-umber.vercel.app` | Builds the feedback link at the end of each comment |
| `PLAYBOOK_WATCH_MS` | `300000` | Optional. How often to pull tickets (default 5 minutes, minimum 1 minute) |
| `PLAYBOOK_WATCH` | `off` | Optional. Turns pulling off |
| `JIRA_PROJECT_KEY` | `CTS` | Optional. Project to watch |
| `JIRA_WEBHOOK_SECRET` | random string | **Optional.** Only needed if you use the webhook below |

The watcher uses the existing `JIRA_BASE_URL`, `JIRA_EMAIL` and `JIRA_API_TOKEN`, so there is nothing new to set up on the Jira side.

## (Optional) Jira Automation webhook: makes comments arrive instantly

1. Open **Project settings → Automation → Create rule**
2. Trigger: **Work item created** (older UI: "Issue created")
3. Action: **Send web request**
   - Web request URL: `https://jira-master.onrender.com/api/hooks/jira/issue-created`
   - HTTP method: `POST`
   - Web request body: **Custom data**
     ```json
     {"key":"{{issue.key}}"}
     ```
   - Headers:
     - `Content-Type` = `application/json`
     - `X-CTS-Secret` = the same value as `JIRA_WEBHOOK_SECRET` on Render (tick "Hidden" so it isn't shown)
   - Do **not** tick "Wait for response" (the system replies 202 right away anyway)
4. Name the rule "CTS Dashboard – ส่งคู่มือ L1", then Turn on.
5. Test it: create a test ticket whose summary contains one of a playbook's keywords. After about 20–30 seconds an internal comment (yellow "Internal note" label) should appear.
   - If it doesn't, check the rule's **Audit log** in Jira, and the Render logs for lines starting `[playbook]`.

> The comment is posted with the shared API token's account, so that account must be allowed to add
> internal comments in CTS (it must be an agent in the service project). A playbook sent with the button
> in the ticket window is posted as the user's own account if they connected Jira under "บัญชีของฉัน".

## Automatic Confluence search (no need to write a playbook for every topic)

If no playbook written in the app matches, the system searches Confluence using the ticket's summary and description. It then puts links to the 1–3 best-matching pages into the internal comment, with a short excerpt from each page.

- **Order**: a written playbook (score 60% or more) comes first. If none matches, the Confluence search runs.
- **Search**: filler words ("ไม่ได้", "ครับ", "ลูกค้า", "error", ticket keys, numbers, licence plates) are removed first, then the system searches by page title and content in the chosen spaces.
- **Ranking**: results are re-ranked by how similar the page title is to the summary and how many of the search words appear in the page. A page is auto-sent only if it scores above the threshold (default 50%).
- **Off by default**: an admin turns it on under "คู่มือ L1" → "ค้นคู่มือจาก Confluence อัตโนมัติ".
  - Try several summaries in "ลองกับ ticket สมมติ" first. It shows the score for each page.
  - If wrong links come up often, raise the minimum match score.
- **In the ticket window**: the pages found are listed with a "ส่งลิงก์ให้ L1" button (for editors). Only pages the search actually returned for that ticket can be sent.
- **Feedback and stats**: work the same as for playbooks ("Confluence: …" in the "ส่งล่าสุด" list).

### Search only under one page (e.g. "Tech Knowledge and Solution")

Without a limit, the system searches every page in the space. That includes Tech Support pages, which are not manuals.

To limit it:
1. Go to คู่มือ L1 → "ค้นคู่มือจาก Confluence อัตโนมัติ".
2. In the "ค้นเฉพาะหน้าที่อยู่ใต้หน้านี้" field, type `Tech Knowledge and Solution`. A link to the page also works.
3. Press "บันทึกการตั้งค่า".

From then on, search and page-reading only cover that page and its child pages at every level (CQL `ancestor in (...)`).
- Several roots can be entered, one per line.
- If two pages share the same title, paste the page link instead.
- Tickets already checked before the limit was set: press "ตรวจใหม่" to see the new result.

### Confluence environment variables on Render

Confluence is on `anls.atlassian.net`, a different site from Jira (`ascendcommerce-support.atlassian.net`), so it needs its own credentials:

| Variable | Value |
|---|---|
| `CONFLUENCE_BASE_URL` | `https://anls.atlassian.net` |
| `CONFLUENCE_EMAIL` | email of an account that can read space ANLTS (a dedicated read-only bot account is best) |
| `CONFLUENCE_API_TOKEN` | API token of that account, created at https://id.atlassian.com/manage-profile/security/api-tokens |
| `CONFLUENCE_SPACES` | `ANLTS` (default space; an admin can change it in the app) |

The token lives only in Render's environment variables. It is not stored in the database and not shown in the app. After setting it, press "ทดสอบการเชื่อมต่อ" on the คู่มือ L1 page.

> L1 must also have access to space ANLTS on anls, otherwise clicking the link opens an access-request page.
> Thai search on Confluence is weaker than English. For topics where people write tickets in Thai, still write a playbook with Thai keywords.

## Using it

- **"คู่มือ L1" menu**: add or edit playbooks (title, Confluence link, keywords, steps, Type of Issue / system limits).
  - Click "กดส่งเอง" / "อัตโนมัติ" in the table to switch the send mode.
- **"ลองกับ ticket สมมติ"**: paste a summary to see which playbook would be sent, with its score and a preview of the comment. Do this before turning on auto-send for a new playbook.
- **Stats**:
  - Times sent.
  - Matched / not matched, from L1 feedback.
  - "จบที่ L1": the share of tickets that got the playbook and never went to L2/L3. It is read from reports already synced, so it updates after the weekly sync or "รีเฟรชจาก Jira".
- **Feedback**: the link at the end of the comment opens the คู่มือ L1 page so L1 can mark it "ตรง ช่วยได้" or "ไม่ตรงเรื่อง". A playbook marked "ไม่ตรง" often should have its keywords tightened or auto-send turned off.

## Tips for writing playbooks

- Start with the 5 categories most often escalated from L1 (look at the "การส่งต่อจาก L1" panel on the dashboard).
- Keywords should be specific: use `gps, ตำแหน่งรถ` rather than `รถ`. Spaces are ignored, so `ตำแหน่ง รถ` = `ตำแหน่งรถ`.
- Keep it to 3–6 steps that L1 can follow on their own, and end with "ถ้ายังไม่ได้ ส่งต่อ L2 พร้อม …" so that escalated tickets come with complete information.
- Set Type of Issue / system only when it really matters. When set, tickets that don't match are skipped.

## Files

- backend:
  - `src/lib/playbooks.ts` (matching, comment, sending)
  - `src/routes/playbooks.ts`
  - `src/lib/watcher.ts` (pulls new tickets from Jira)
  - `src/routes/hooks.ts` (optional webhook)
  - `src/lib/jira.ts` (fetchTicketForPlaybook, addInternalComment, recentTicketKeys)
  - `prisma/schema.prisma` (Playbook, PlaybookDelivery)
- backend (Confluence): `src/lib/confluence.ts` (search + page-body recheck); `PlaybookDelivery.pages` and the `TicketCheck` model in the schema
- frontend:
  - `app/playbooks/page.tsx`
  - `components/playbooks/AdfPreview.tsx`
  - `components/dashboard/TicketPlaybooks.tsx`
  - `lib/api.ts`
  - nav and Ctrl+K entries
