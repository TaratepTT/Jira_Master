# Manual page template for "Tech Knowledge and Solution"

Use these headings on every page. The CTS Dashboard matches pages to tickets more accurately and
can pull the steps out by itself.

To make it a Confluence template: Space settings → Look and feel / Templates → Create new template
→ paste the layout below → Save.

---

**Page title:** what the user sees, in their own words, with the exact system wording.
Example: `Cannot import excel trip file`, `GPS รถไม่อัปเดตตำแหน่ง`

## อาการ
Write what the user says / sees, using the words people actually type in tickets. Thai and English both work.
- e.g. กด import excel trip แล้วไม่ผ่าน, ไฟล์ trip อัปโหลดไม่ได้

## ข้อความ error
Copy the error message exactly, character for character (the system checks for it word for word).
- e.g. `Template version mismatch`

## ระบบ / เมนูที่เกี่ยวข้อง
CMP / VMP / CP TMS, and the menu where it happens

## สาเหตุ
One or two lines on why it happens

## วิธีแก้
Use a **numbered list** only (the system takes up to 8 items):
1. ...
2. ...
3. ...

## ถ้ายังไม่ได้
Who to escalate to, and what to attach
- e.g. ส่งต่อ L2 พร้อมไฟล์ที่ import และ screenshot error

---

### Writing tips
- Under "วิธีแก้", one item = one action L1 can do alone. Write sub-points as a sub-list under that item.
- Don't put the steps in a table or in a long paragraph. The system only reads numbered lists.
- One page = one problem. Don't combine several problems on one page, because matching gets less accurate.
- Keep pages under "Tech Knowledge and Solution" (they can be several levels down).
