import {
  buildPickemSlots,
  type PickemEvent,
  type PickemLinkedResult,
  type PickemMatch,
  type PickemSlot,
} from '$lib/pickems'
import type { RankPoint } from '$lib/server/leaderboard/rank-history'
import { ordinal } from '$lib/format/ordinal'

/**
 * Where a team can still finish in a playoff bracket, read off the bracket's
 * own routing — so it works for double elim, single elim, or any custom shape.
 *
 * A slot whose loser is not fed anywhere eliminates that loser. Finishing
 * places are handed out from the top: the final gives 1st and 2nd, then each
 * depth of eliminations (deepest first) takes the next places, shared when
 * several slots sit at the same depth (both lower quarter-final losers are
 * 5th–6th). A team still alive is guaranteed whatever losing every remaining
 * match would give it: a team in the lower final has locked at least 3rd.
 */
export type PlayoffPlacement = {
  /** Best place still reachable (1 while alive). */
  best: number
  /** First place of the range the team ends in if it loses out. */
  worstStart: number
  /** Last place of that range — the place the team has locked. */
  worstEnd: number
  /** True once the team is eliminated or has won the final. */
  decided: boolean
}

type Range = { start: number; end: number }

const loserOf = (slot: PickemSlot | undefined) =>
  slot?.winnerId && slot.teamAId && slot.teamBId
    ? slot.winnerId === slot.teamAId
      ? slot.teamBId
      : slot.teamAId
    : null

export function bracketPlacement(
  matches: PickemMatch[],
  slots: PickemSlot[],
  teamId: string
): PlayoffPlacement | null {
  if (matches.length === 0) return null
  const sorted = [...matches].sort((a, b) => a.sortOrder - b.sortOrder)
  const slotById = new Map(slots.map((s) => [s.id, s]))

  // Depth = longest path from the seeds; feeds say where results go.
  const depth = new Map<string, number>()
  const winnerTo = new Map<string, string>()
  const loserTo = new Map<string, string>()
  for (const m of sorted) {
    let d = 0
    for (const feed of [m.feedA, m.feedB]) {
      if (!feed || feed.type === 'seed') continue
      ;(feed.type === 'winner' ? winnerTo : loserTo).set(feed.of, m.slotKey)
      d = Math.max(d, depth.get(feed.of) ?? 0)
    }
    depth.set(m.slotKey, d + 1)
  }

  const terminal = sorted.filter((m) => !winnerTo.has(m.slotKey) && !loserTo.has(m.slotKey))
  if (terminal.length === 0) return null
  const final = terminal.reduce((a, b) => (depth.get(b.slotKey)! > depth.get(a.slotKey)! ? b : a))

  // Places for the winner and loser of every slot that settles a finish.
  const winnerPlace = new Map<string, Range>([[final.slotKey, { start: 1, end: 1 }]])
  const loserPlace = new Map<string, Range>([[final.slotKey, { start: 2, end: 2 }]])
  const eliminations = sorted.filter((m) => m !== final && !loserTo.has(m.slotKey))
  const depths = [...new Set(eliminations.map((m) => depth.get(m.slotKey)!))].sort((a, b) => b - a)
  let next = 3
  for (const d of depths) {
    const group = eliminations.filter((m) => depth.get(m.slotKey) === d)
    // A terminal non-final slot (a 3rd-place match) places both its teams.
    const size = group.reduce((n, m) => n + (winnerTo.has(m.slotKey) ? 1 : 2), 0)
    const shared = { start: next, end: next + size - 1 }
    for (const m of group) {
      if (group.length === 1 && !winnerTo.has(m.slotKey)) {
        winnerPlace.set(m.slotKey, { start: next, end: next })
        loserPlace.set(m.slotKey, { start: next + 1, end: next + 1 })
      } else {
        loserPlace.set(m.slotKey, shared)
        if (!winnerTo.has(m.slotKey)) winnerPlace.set(m.slotKey, shared)
      }
    }
    next += size
  }

  const worstFrom = (slotKey: string): Range => {
    const onward = loserTo.get(slotKey)
    return onward ? worstFrom(onward) : (loserPlace.get(slotKey) ?? { start: next, end: next })
  }
  const bestFrom = (slotKey: string): number => {
    const onward = winnerTo.get(slotKey)
    return onward ? bestFrom(onward) : (winnerPlace.get(slotKey)?.start ?? 1)
  }

  // Walk the team's own path through the bracket.
  const mine = sorted.filter((m) => {
    const s = slotById.get(m.slotKey)
    return s?.teamAId === teamId || s?.teamBId === teamId
  })
  if (mine.length === 0) return null

  for (const m of mine) {
    const s = slotById.get(m.slotKey)!
    if (!s.winnerId) {
      const worst = worstFrom(m.slotKey)
      return {
        best: bestFrom(m.slotKey),
        worstStart: worst.start,
        worstEnd: worst.end,
        decided: false,
      }
    }
    const lost = loserOf(s) === teamId
    if (lost && !loserTo.has(m.slotKey)) {
      const place = loserPlace.get(m.slotKey)!
      return { best: place.start, worstStart: place.start, worstEnd: place.end, decided: true }
    }
    if (!lost && !winnerTo.has(m.slotKey)) {
      const place = winnerPlace.get(m.slotKey) ?? { start: 1, end: 1 }
      return { best: place.start, worstStart: place.start, worstEnd: place.end, decided: true }
    }
  }

  // Through every slot they appear in, waiting on an opponent for the next.
  const last = mine[mine.length - 1]
  const lastSlot = slotById.get(last.slotKey)!
  const onward =
    loserOf(lastSlot) === teamId ? loserTo.get(last.slotKey) : winnerTo.get(last.slotKey)
  if (!onward) return null
  const worst = worstFrom(onward)
  return { best: bestFrom(onward), worstStart: worst.start, worstEnd: worst.end, decided: false }
}

export type DatedBracket = {
  event: Pick<PickemEvent, 'seeds'>
  matches: PickemMatch[]
  linkedResults: Record<string, PickemLinkedResult>
  /** When each slot's real match was played (epoch ms), keyed by slot. */
  playedAt: Record<string, number>
}

/**
 * The team's placement with only the results in by `cutoff`. Admin-resolved
 * winners carry no date, so they count only when `includeUndated` is set (the
 * newest point).
 */
export function placementAt(
  bracket: DatedBracket,
  teamId: string,
  cutoff: number,
  includeUndated: boolean
): PlayoffPlacement | null {
  const linked: Record<string, PickemLinkedResult> = {}
  for (const [slot, result] of Object.entries(bracket.linkedResults)) {
    const at = bracket.playedAt[slot]
    const known = at !== undefined ? at < cutoff : includeUndated
    linked[slot] = known ? result : { ...result, winnerId: null }
  }
  const matches = includeUndated
    ? bracket.matches
    : bracket.matches.map((m) => ({ ...m, actualWinnerId: null }))
  const slots = buildPickemSlots(bracket.event, matches, { picks: {} }, linked)
  return bracketPlacement(matches, slots, teamId)
}

export { ordinal }

/** Short reading of a placement: "Top 3 locked", "Finished 3rd", "Champions". */
export function describePlacement(p: PlayoffPlacement): string {
  if (p.decided) {
    if (p.worstStart === 1) return 'Champions'
    return p.worstStart === p.worstEnd
      ? `Finished ${ordinal(p.worstStart)}`
      : `Finished ${ordinal(p.worstStart)}–${ordinal(p.worstEnd)}`
  }
  if (p.worstEnd <= 2) return 'In the final'
  return `Top ${p.worstEnd} locked`
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Replace each weekly point from the first playoff result on with the place
 * the team had locked by the end of that week. Teams outside the bracket keep
 * their standings rank.
 */
export function withPlayoffPlacements(
  points: RankPoint[],
  bracket: DatedBracket | null,
  teamId: string,
  now: number = Date.now()
): RankPoint[] {
  if (!bracket || points.length === 0) return points
  const dates = Object.values(bracket.playedAt)
  const firstResult = dates.length > 0 ? Math.min(...dates) : null
  const hasUndated = bracket.matches.some((m) => m.actualWinnerId)
  const size = bracket.event.seeds.length || bracket.matches.length + 1

  return points.map((point, i) => {
    const isLatest = i === points.length - 1
    const cutoff = isLatest ? now : Date.parse(`${point.week_end}T00:00:00Z`) + DAY_MS
    const started = (firstResult !== null && firstResult < cutoff) || (isLatest && hasUndated)
    if (!started) return point
    const placement = placementAt(bracket, teamId, cutoff, isLatest)
    if (!placement) return point
    return {
      ...point,
      rank: placement.decided ? placement.worstStart : placement.worstEnd,
      of: size,
      playoff: {
        label: describePlacement(placement),
        best: placement.best,
        worst_start: placement.worstStart,
        worst_end: placement.worstEnd,
        decided: placement.decided,
      },
    }
  })
}
