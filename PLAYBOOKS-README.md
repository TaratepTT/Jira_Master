# คู่มือ L1 (Playbooks): ส่งคู่มือให้ L1 อัตโนมัติเมื่อมี ticket ใหม่

When someone opens a new ticket in project CTS, the system finds a matching manual and adds an
**internal comment** to the ticket. The comment holds the short steps, the Confluence link and similar
solved tickets. L1 reads it and does the work without escalating. Customers on the JSM portal
**do not see** this comment: it is sent with the `sd.public.comment = internal` property.

## How it works

1. Jira Automation rule "Work item created" → calls `POST /api/hooks/jira/issue-created`
2. The backend replies 202 straight away. About 20 seconds later it fetches the ticket with the shared token (so custom fields have time to fill in).
3. It matches the summary and description against every playbook that is set to "send automatically".
   - A keyword found in the summary scores 60% or more, which is enough to auto-send.
   - A keyword found only in the description scores less and is not auto-sent.
4. It adds an internal comment. **It never sends twice** (unique playbook+ticket constraint), even if the webhook fires more than once.
5. A sweeper runs every 10 minutes and checks tickets from the last 2 hours. This catches webhooks missed while Render was asleep.

A playbook that is not set to auto-send still shows up in the ticket window under "คู่มือ L1", with a **"ส่งให้ L1 ใน Jira"** button for an editor to send it by hand.

## Deploy

```powershell
cd D:\Jira_Master
# extract cts-all-in-one-v5.zip over the repo, then
cd cts-backend
npx prisma db push        # creates the playbooks and playbook_deliveries tables
npm install
npm run build
cd ..\cts-frontend
npm install
npm run build
cd ..
git add -A
git commit -m "Playbooks: auto-send L1 manuals as internal Jira comments"
git push
```

### New environment variables on Render (backend)

| Variable | Value | Notes |
|---|---|---|
| `JIRA_WEBHOOK_SECRET` | a long random string, e.g. from `[guid]::NewGuid()` run twice | **Required.** Without it the webhook and the sweeper are off. |
| `FRONTEND_URL` | `https://jira-master-umber.vercel.app` | Builds the "คู่มือไม่ตรงเรื่อง? แจ้งที่นี่" link in the comment. If not set, the first value of ALLOWED_ORIGINS is used. |
| `JIRA_PROJECT_KEY` | `CTS` | Optional. Project the sweeper checks. |
| `PLAYBOOK_SWEEP` | `off` | Optional. Turns the sweeper off. |

## Jira Automation rule (needs a Jira admin / project admin)

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
  - `src/routes/hooks.ts` (webhook + sweeper)
  - `src/lib/jira.ts` (fetchTicketForPlaybook, addInternalComment, recentTicketKeys)
  - `prisma/schema.prisma` (Playbook, PlaybookDelivery)
- backend (Confluence): `src/lib/confluence.ts`; `PlaybookDelivery.pages` field in the schema
- frontend:
  - `app/playbooks/page.tsx`
  - `components/playbooks/AdfPreview.tsx`
  - `components/dashboard/TicketPlaybooks.tsx`
  - `lib/api.ts`
  - nav and Ctrl+K entries
