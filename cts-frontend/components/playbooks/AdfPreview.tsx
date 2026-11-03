import type { ReactNode } from 'react'

// Minimal renderer for the Atlassian Document Format the backend posts as the Jira comment,
// so the preview looks like what L1 will see.
type Node = { type?: string; text?: string; content?: Node[]; marks?: Array<{ type: string; attrs?: { href?: string } }> }

function render(n: Node, i: number): ReactNode {
  const kids = (n.content ?? []).map(render)
  switch (n.type) {
    case 'doc': return <div key={i} className="space-y-2">{kids}</div>
    case 'paragraph': return <p key={i} className="text-[13px] leading-relaxed text-ink">{kids}</p>
    case 'orderedList': return <ol key={i} className="ml-5 list-decimal space-y-0.5">{kids}</ol>
    case 'bulletList': return <ul key={i} className="ml-5 list-disc space-y-0.5">{kids}</ul>
    case 'listItem': return <li key={i}>{kids}</li>
    case 'text': {
      let el: ReactNode = n.text
      for (const m of n.marks ?? []) {
        if (m.type === 'strong') el = <strong>{el}</strong>
        else if (m.type === 'em') el = <em className="text-muted">{el}</em>
        else if (m.type === 'link' && m.attrs?.href) el = <a href={m.attrs.href} target="_blank" rel="noreferrer" className="text-accent underline">{el}</a>
      }
      return <span key={i}>{el}</span>
    }
    default: return <span key={i}>{kids}</span>
  }
}

export default function AdfPreview({ doc }: { doc: unknown }) {
  // long URLs / error codes have no spaces: let them wrap anywhere so the preview never leaves its box
  return <div className="min-w-0 break-words [overflow-wrap:anywhere]">{render(doc as Node, 0)}</div>
}
