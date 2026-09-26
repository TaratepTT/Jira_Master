// ══════════════════════════════════════════════════════════════
// ── COMMENTS & CHANGELOG — read ticket activity history ────────
// ══════════════════════════════════════════════════════════════

export interface JiraComment {
  id: string
  author: string
  body: string
  created: string
}

export interface JiraChangelogEntry {
  id: string
  author: string
  created: string
  changes: Array<{ field: string; from: string; to: string }>
}

function adfToPlainText(v: unknown): string {
  if (!v) return ''
  if (typeof v === 'string') return v
  try {
    const doc = v as { content?: Array<{ content?: Array<{ text?: string }> }> }
    return (doc.content ?? [])
      .flatMap(b => b.content ?? [])
      .map(n => n.text ?? '')
      .join(' ')
      .trim()
  } catch { return '' }
}

// ── Fetch comments for a ticket ──────────────────────────────────
export async function fetchJiraComments(key: string): Promise<JiraComment[]> {
  const { data } = await jiraClient.get(`/issue/${key}/comment`, {
    params: { orderBy: '-created', maxResults: 50 },
  })
  const comments = (data.comments ?? []) as Array<Record<string, unknown>>
  return comments.map(c => ({
    id:      String(c.id ?? ''),
    author:  String((c.author as { displayName?: string })?.displayName ?? 'Unknown'),
    body:    adfToPlainText(c.body),
    created: String(c.created ?? ''),
  }))
}

// ── Fetch changelog (status/field change history) for a ticket ──
export async function fetchJiraChangelog(key: string): Promise<JiraChangelogEntry[]> {
  const { data } = await jiraClient.get(`/issue/${key}`, {
    params: { expand: 'changelog' },
  })
  const histories = (data.changelog?.histories ?? []) as Array<Record<string, unknown>>

  return histories.map(h => ({
    id:      String(h.id ?? ''),
    author:  String((h.author as { displayName?: string })?.displayName ?? 'Unknown'),
    created: String(h.created ?? ''),
    changes: ((h.items ?? []) as Array<Record<string, unknown>>).map(item => ({
      field: String(item.field ?? ''),
      from:  String(item.fromString ?? '—'),
      to:    String(item.toString ?? '—'),
    })),
  })).reverse() // newest first
}

// ── Add a new comment to a ticket ────────────────────────────────
export async function addJiraComment(key: string, text: string): Promise<void> {
  await jiraClient.post(`/issue/${key}/comment`, {
    body: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text }],
        },
      ],
    },
  })
}
