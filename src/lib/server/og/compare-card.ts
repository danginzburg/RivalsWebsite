import type { CompareCardData } from '$lib/server/compare/load'
import { cardRoot, COLORS, h, headerRow, INNER_WIDTH, logoDataUri, picture, type Node } from './kit'

/**
 * The /compare preview card: two to five players or teams side by side, each
 * with a few key stats (the leader of each highlighted), and for two of them
 * their series record against each other in the middle.
 */

const GAP = 22
const CENTRE = 200
const COLUMN_PAD = 18

/** Picture size for the number of columns. */
const PICTURE = [0, 150, 150, 124, 104, 92]

/** The largest size at which `text` fits one line of `width` (roughly: Nippo Bold is ~0.58em a letter). */
function fitSize(text: string, width: number): number {
  return Math.floor(width / (Math.max(text.length, 1) * 0.58))
}

/**
 * One name size for every column, so the columns line up: the largest that
 * fits each name on a line, but no smaller than needed to fit on two lines
 * (and never below 22px). When any name wraps, every column leaves room for
 * two lines; a single word too long even then breaks mid-word.
 */
function nameLayout(names: string[], width: number): { size: number; lines: 1 | 2 } {
  const oneLine = Math.min(...names.map((n) => fitSize(n, width)))
  if (oneLine >= 30) return { size: Math.min(44, oneLine), lines: 1 }
  const twoLines = Math.min(
    ...names.map((n) =>
      Math.min(fitSize(n, width * 2), ...n.split(/\s+/).map((word) => fitSize(word, width)))
    )
  )
  return { size: Math.max(22, Math.min(36, twoLines)), lines: 2 }
}

const oneLine = {
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
}

function column(
  col: CompareCardData['columns'][number],
  image: string | null,
  width: number,
  pictureSize: number,
  round: boolean,
  name: { size: number; lines: 1 | 2 }
): Node {
  const inner = width - COLUMN_PAD * 2
  return h(
    'div',
    {
      width,
      flexDirection: 'column',
      alignItems: 'center',
      padding: `22px ${COLUMN_PAD}px 16px`,
      borderRadius: 22,
      backgroundColor: COLORS.panel,
    },
    picture(image, col.name, pictureSize, round),
    h(
      'div',
      {
        marginTop: 14,
        width: inner,
        height: Math.ceil(name.size * 1.12 * name.lines),
        alignItems: 'center',
        justifyContent: 'center',
      },
      h(
        'div',
        {
          display: 'block',
          fontSize: name.size,
          fontWeight: 700,
          lineHeight: 1.12,
          maxWidth: inner,
          textAlign: 'center',
          overflow: 'hidden',
          wordBreak: 'break-word',
          lineClamp: name.lines,
        },
        col.name
      )
    ),
    h(
      'div',
      { marginTop: 4, height: 26, fontSize: 20, color: COLORS.faint, maxWidth: inner, ...oneLine },
      col.subtitle ?? ''
    ),
    h(
      'div',
      { marginTop: 10, flexDirection: 'column', width: inner },
      ...col.stats.map((s) =>
        h(
          'div',
          {
            justifyContent: 'space-between',
            alignItems: 'center',
            height: 44,
            padding: '0 12px',
            borderRadius: 10,
            backgroundColor: s.lead ? 'rgba(192, 132, 252, 0.16)' : 'transparent',
          },
          h(
            'div',
            { fontSize: 19, fontWeight: 700, letterSpacing: 2, color: COLORS.muted },
            s.label.toUpperCase()
          ),
          h(
            'div',
            {
              fontSize: 30,
              fontWeight: 700,
              color: s.lead ? COLORS.accent : s.value === '–' ? COLORS.faint : COLORS.text,
            },
            s.value
          )
        )
      )
    )
  )
}

function seriesCentre(card: CompareCardData): Node {
  const series = card.series!
  const score = (n: number, won: boolean) =>
    h(
      'div',
      { fontSize: 88, fontWeight: 700, lineHeight: 1, color: won ? COLORS.text : COLORS.faint },
      String(n)
    )
  return h(
    'div',
    { width: CENTRE, flexDirection: 'column', alignItems: 'center', gap: 12 },
    h(
      'div',
      { alignItems: 'center', gap: 16 },
      score(series.won, series.won >= series.lost),
      h('div', { fontSize: 60, color: COLORS.faint, lineHeight: 1 }, '–'),
      score(series.lost, series.lost >= series.won)
    ),
    h(
      'div',
      {
        fontSize: 20,
        fontWeight: 700,
        letterSpacing: 2,
        color: COLORS.accent,
      },
      'HEAD TO HEAD'
    )
  )
}

export async function buildCompareCard(card: CompareCardData): Promise<Node> {
  const count = card.columns.length
  const pictureSize = PICTURE[count] ?? 92
  const round = card.kind === 'players'
  const images = await Promise.all(
    card.columns.map((c) => logoDataUri(c.image, pictureSize * 2, round))
  )

  const withCentre = count === 2 && card.series != null
  const width = withCentre
    ? Math.floor((INNER_WIDTH - CENTRE - GAP * 2) / 2)
    : Math.floor((INNER_WIDTH - GAP * (count - 1)) / count)
  const name = nameLayout(
    card.columns.map((c) => c.name),
    width - COLUMN_PAD * 2
  )
  const columns = card.columns.map((c, i) =>
    column(c, images[i] ?? null, width, pictureSize, round, name)
  )

  const label =
    card.kind === 'teams'
      ? 'Team comparison'
      : `Player comparison${card.scopeLabel ? ` · ${card.scopeLabel}` : ''}`

  return cardRoot(
    {},
    headerRow(label),
    h(
      'div',
      { gap: GAP, alignItems: 'center', justifyContent: 'center' },
      ...(withCentre ? [columns[0]!, seriesCentre(card), columns[1]!] : columns)
    )
  )
}
