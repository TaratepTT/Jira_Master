// Strips personal / sensitive tokens from free text BEFORE it leaves our server.
//
// What it does NOT do: it cannot recognise personal NAMES in free text (e.g. a Thai
// first name inside a root-cause sentence). Ticket text can still contain names.
// That's why sending is always an explicit, confirmed action in the UI.

const RULES: Array<[RegExp, string]> = [
  // URLs first — they can carry tokens, ids and emails
  [/https?:\/\/[^\s)>\]"']+/gi, '[ลิงก์]'],
  // e-mail addresses
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '[อีเมล]'],
  // Thai phone numbers: 0812345678, 081-234-5678, 02-123-4567, +66 81 234 5678
  [/(?<!\d)(?:\+?66[\s-]?|0)\d{1,2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)/g, '[เบอร์โทร]'],
  // Thai citizen id written with separators: 1-2345-67890-12-3 / 1 2345 67890 12 3
  [/(?<!\d)\d[\s-]\d{4}[\s-]\d{5}[\s-]\d{2}[\s-]\d(?!\d)/g, '[เลขบัตร]'],
  // card-style groups: 1234 5678 9012 3456 / 1234-5678-9012-3456
  [/(?<!\d)\d{4}(?:[\s-]\d{4}){3}(?!\d)/g, '[เลขบัตร]'],
  // any other run of 9+ digits (13-digit ids, card numbers, long order ids …)
  [/\d{9,}/g, '[ตัวเลข]'],
]

export function redact(text: string | null | undefined): string {
  let out = text ?? ''
  for (const [re, label] of RULES) out = out.replace(re, label)
  return out
}
