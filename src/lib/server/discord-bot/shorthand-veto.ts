/**
 * Vetoes typed by hand in a scheduling thread, alongside the veto bot's log:
 *
 *   VP Bans Lotus
 *   NVG Bans Fracture
 *   VP Picks Pearl (NVG Def)
 *   NVG Pick Haven (VP Atk)
 *   VP Ban Split
 *   Nvg ban ascent
 *   Breeze remains (VP Atk)
 *
 * Teams are the match's two teams (by tag or name) and maps come from the
 * map pool, both compared without case, spaces or punctuation. A block only
 * counts as a veto if it accounts for every map in the pool exactly once,
 * with one decider and both teams taking part, so ordinary chat ("we pick
 * haven?") never sets one.
 *
 * The result uses the same lines as an imported veto-bot log, e.g.
 * "VP picks Pearl · NVG starts Defender" and "Breeze decider · VP starts Attacker".
 */

export type ShorthandTeam = { name: string; tag?: string | null }

export type ShorthandContext = {
  /** The linked match's two teams. */
  teams: ShorthandTeam[]
  /** The season's map pool; without one, any 7 distinct competitive maps. */
  mapPool: string[] | null
}

/** Competitive maps past and present, for recognising names when a season has no pool. */
export const KNOWN_MAPS = [
  'Abyss',
  'Ascent',
  'Bind',
  'Breeze',
  'Corrode',
  'Fracture',
  'Haven',
  'Icebox',
  'Lotus',
  'Pearl',
  'Split',
  'Sunset',
]

/** The usual competitive pool size, required when the season has no pool. */
const POOL_SIZE = 7

type Side = 'Attacker' | 'Defender'

const SIDE_WORDS: Record<string, Side> = {
  atk: 'Attacker',
  att: 'Attacker',
  attack: 'Attacker',
  attacker: 'Attacker',
  attacking: 'Attacker',
  def: 'Defender',
  defense: 'Defender',
  defence: 'Defender',
  defender: 'Defender',
  defending: 'Defender',
}

const SIDE_RE = Object.keys(SIDE_WORDS).join('|')
const ACTION_RE = /^(.+?)\s+(ban|bans|banned|pick|picks|picked)\s+(.+)$/i
const DECIDER_AFTER_RE = /^(.+?)\s+(?:remains|decider|is\s+(?:the\s+)?decider)$/i
const DECIDER_BEFORE_RE = /^decider\s*:?\s+(.+)$/i
const SIDE_LINE_RE = new RegExp(`^(.+?)\\s+(${SIDE_RE})\\s+(?:on\\s+)?(.+)$`, 'i')
const SIDE_NOTE_RE = new RegExp(`^(.+?)\\s+(${SIDE_RE})$`, 'i')

function compact(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** "Breeze remains (VP Atk)" → ["Breeze remains", "VP Atk"]. */
function splitNote(line: string): [string, string | null] {
  const m = /^(.*?)\s*\(([^()]*)\)\s*[.!]*$/.exec(line)
  return m ? [m[1]!.trim(), m[2]!.trim()] : [line.replace(/[.!]+$/, '').trim(), null]
}

type Step = { kind: 'ban' | 'pick' | 'decider'; map: string; team: string | null }

/**
 * The veto `lines` spell out, as the match page stores it, or null when they
 * don't add up to one complete veto for this match.
 */
export function parseShorthandVeto(lines: string[], context: ShorthandContext): string[] | null {
  const labelOf = (team: ShorthandTeam) => team.tag?.trim() || team.name
  const teamKeys = context.teams.map((team) => ({
    label: labelOf(team),
    keys: [team.tag, team.name].filter((k): k is string => Boolean(k)).map(compact),
  }))
  if (teamKeys.length !== 2) return null
  const teamFor = (text: string): string | null => {
    const key = compact(text)
    return teamKeys.find((t) => t.keys.includes(key))?.label ?? null
  }

  const pool = context.mapPool?.length ? context.mapPool : KNOWN_MAPS
  const mapFor = (text: string): string | null =>
    pool.find((map) => compact(map) === compact(text)) ?? null

  const steps: Step[] = []
  const sides = new Map<string, { team: string; side: Side }>()
  let consistent = true

  const addSide = (map: string, team: string, side: Side) => {
    const existing = sides.get(map)
    if (!existing) {
      sides.set(map, { team, side })
      return
    }
    // The same fact twice, or the other team's side said the other way round, agree.
    const agrees =
      (existing.team === team && existing.side === side) ||
      (existing.team !== team && existing.side !== side)
    if (!agrees) consistent = false
  }

  const readNote = (note: string | null, map: string) => {
    if (!note) return
    const m = SIDE_NOTE_RE.exec(note)
    const team = m ? teamFor(m[1]!) : null
    if (!m || !team) {
      consistent = false
      return
    }
    addSide(map, team, SIDE_WORDS[m[2]!.toLowerCase()]!)
  }

  for (const raw of lines) {
    const line = raw.trim().replace(/\s+/g, ' ')
    if (!line) continue
    const [body, note] = splitNote(line)

    const action = ACTION_RE.exec(body)
    if (action) {
      const team = teamFor(action[1]!)
      const map = mapFor(action[3]!)
      if (team && map) {
        const kind = action[2]!.toLowerCase().startsWith('ban') ? 'ban' : 'pick'
        steps.push({ kind, map, team })
        readNote(note, map)
        continue
      }
    }

    const decider = DECIDER_AFTER_RE.exec(body) ?? DECIDER_BEFORE_RE.exec(body)
    if (decider) {
      const map = mapFor(decider[1]!)
      if (map) {
        steps.push({ kind: 'decider', map, team: null })
        readNote(note, map)
        continue
      }
    }

    const sideLine = SIDE_LINE_RE.exec(body)
    if (sideLine && !note) {
      const team = teamFor(sideLine[1]!)
      const map = mapFor(sideLine[3]!)
      if (team && map) {
        addSide(map, team, SIDE_WORDS[sideLine[2]!.toLowerCase()]!)
        continue
      }
    }
    // Anything else is chat around the veto.
  }

  if (!consistent || steps.length === 0) return null

  // Every map in the pool exactly once, one decider, at least one pick, both teams acting.
  const maps = steps.map((s) => s.map)
  if (new Set(maps).size !== maps.length) return null
  const expected = context.mapPool?.length ? context.mapPool.length : POOL_SIZE
  if (maps.length !== expected) return null
  if (context.mapPool?.length && !context.mapPool.every((map) => maps.includes(map))) return null
  if (steps.filter((s) => s.kind === 'decider').length !== 1) return null
  if (!steps.some((s) => s.kind === 'pick')) return null
  const actors = new Set(steps.map((s) => s.team).filter(Boolean))
  if (actors.size !== 2) return null

  // Sides only make sense on maps that get played.
  for (const map of sides.keys()) {
    const step = steps.find((s) => s.map === map)
    if (!step || step.kind === 'ban') return null
  }

  return steps.map((step) => {
    const text =
      step.kind === 'decider'
        ? `${step.map} decider`
        : `${step.team} ${step.kind === 'ban' ? 'bans' : 'picks'} ${step.map}`
    const side = sides.get(step.map)
    return side ? `${text} · ${side.team} starts ${side.side}` : text
  })
}
