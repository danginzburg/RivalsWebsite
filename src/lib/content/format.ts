/**
 * Light formatting for admin-written content bodies. Parsed into a tree the
 * page renders with ordinary elements, never `{@html}`, so admin text cannot
 * inject markup.
 *
 * Block syntax (one per line):
 *   blank line   -> new paragraph
 *   ### Heading  -> small heading
 *   - item       -> bulleted list
 *   1. item      -> numbered list
 *   > text       -> highlighted note
 *
 * Inline syntax: **bold**, *italic*, [link text](https://... or /path).
 */

export type InlineSegment =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'link'; text: string; href: string; external: boolean }

export type ContentBlock =
  | { type: 'p'; lines: InlineSegment[][] }
  | { type: 'h'; inline: InlineSegment[] }
  | { type: 'note'; lines: InlineSegment[][] }
  | { type: 'ul' | 'ol'; items: InlineSegment[][] }

export const FORMAT_HELP = [
  ['### Heading', 'small heading'],
  ['- item', 'bullet list'],
  ['1. item', 'numbered list'],
  ['> text', 'highlighted note'],
  ['**bold** / *italic*', 'emphasis'],
  ['[text](https://…)', 'link'],
  ['blank line', 'new paragraph'],
] as const

const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g

function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:|\/|#)/i.test(href) ? href : null
}

export function parseInline(source: string): InlineSegment[] {
  const out: InlineSegment[] = []
  let last = 0
  for (const match of source.matchAll(INLINE)) {
    const index = match.index ?? 0
    if (index > last) out.push({ type: 'text', text: source.slice(last, index) })
    if (match[1] !== undefined) out.push({ type: 'bold', text: match[1] })
    else if (match[2] !== undefined) out.push({ type: 'italic', text: match[2] })
    else {
      const href = safeHref(match[4])
      out.push(
        href
          ? { type: 'link', text: match[3], href, external: /^https?:/i.test(href) }
          : { type: 'text', text: match[0] }
      )
    }
    last = index + match[0].length
  }
  if (last < source.length) out.push({ type: 'text', text: source.slice(last) })
  return out
}

export function parseContent(body: string): ContentBlock[] {
  const blocks: ContentBlock[] = []
  // Held in an object so TypeScript does not narrow it across flush() calls.
  const open: { block: ContentBlock | null } = { block: null }

  const flush = () => {
    if (open.block) blocks.push(open.block)
    open.block = null
  }

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const bullet = /^[-*•]\s+(.*)$/.exec(line)
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line)
    const note = /^>\s?(.*)$/.exec(line)
    const current = open.block

    if (heading) {
      flush()
      blocks.push({ type: 'h', inline: parseInline(heading[1]) })
    } else if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol'
      const item = parseInline((bullet ?? numbered)![1])
      if ((current?.type === 'ul' || current?.type === 'ol') && current.type === type) {
        current.items.push(item)
      } else {
        flush()
        open.block = { type, items: [item] }
      }
    } else if (note) {
      if (current?.type === 'note') current.lines.push(parseInline(note[1]))
      else {
        flush()
        open.block = { type: 'note', lines: [parseInline(note[1])] }
      }
    } else if (current?.type === 'p') {
      current.lines.push(parseInline(line))
    } else {
      flush()
      open.block = { type: 'p', lines: [parseInline(line)] }
    }
  }
  flush()
  return blocks
}

/** Plain text of a body, for search matching. */
export function contentPlainText(body: string): string {
  return body.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*#>]/g, '')
}
