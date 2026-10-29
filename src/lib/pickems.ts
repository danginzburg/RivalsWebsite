/**
 * Data-driven pick'em engine.
 *
 * A pick'em is a list of prediction *units* (`PickemMatch`) that a user picks a
 * winner for. Two formats share the same engine:
 *
 * - `matchups` — each unit already carries its two teams (a weekly, non-bracket
 *   slate); picks are independent.
 * - `bracket`  — units carry `feed_a`/`feed_b` topology instead of teams, and
 *   the teams propagate from seeds and the winners/losers of earlier units.
 *
 * Scoring, ranking, validation, and the submission payload shape
 * (`{ picks: Record<slotKey, teamId> }`) are identical across both formats.
 */

export const PICKEM_FORMATS = ['bracket', 'matchups'] as const
export type PickemFormat = (typeof PICKEM_FORMATS)[number]

export type PickemStatus = 'draft' | 'open' | 'locked' | 'scored'

/** Where a bracket slot's team comes from. `null` for directly-assigned teams. */
export type PickemFeed =
  | { type: 'seed'; seed: number }
  | { type: 'winner'; of: string }
  | { type: 'loser'; of: string }

export type PickemSeed = { seed: number; teamId: string }

export type PickemTeam = {
  id: string
  name: string
  tag: string | null
  logo_url?: string | null
}

/** One prediction unit — a row of `pickem_matches`. */
export type PickemMatch = {
  slotKey: string
  groupKey: string
  sortOrder: number
  label: string
  points: number
  /** Assigned directly (matchups) or null when derived from `feedA` (bracket). */
  teamAId: string | null
  teamBId: string | null
  feedA: PickemFeed | null
  feedB: PickemFeed | null
  /** The real match whose result decides this unit's actual winner. */
  linkedMatchId: string | null
  /** Admin hard-resolved winner: pre-concluded, excluded from scoring. */
  actualWinnerId: string | null
}

export type PickemEvent = {
  id: string
  seasonId: string
  format: PickemFormat
  title: string
  status: PickemStatus
  lockAt: string | null
  /** Bracket seeds keyed by seed number; empty for matchups. */
  seeds: PickemSeed[]
}

export type PickemPayload = { picks: Record<string, string> }

/** A resolved unit ready for display. `id` is the slot key. */
export type PickemSlot = {
  id: string
  label: string
  groupKey: string
  points: number
  teamAId: string | null
  teamBId: string | null
  winnerId: string | null
}

/**
 * The actual teams/winner of a slot's linked real match. When a bracket is
 * reconstructed after the fact, the real match — not the fixed routing — is the
 * source of truth: a reconstructed lower bracket can route losers differently
 * than the template, and without this the mismatched teams drop to TBD.
 */
export type PickemLinkedResult = {
  teamAId?: string | null
  teamBId?: string | null
  winnerId?: string | null
}

export type PickemScoreResult = {
  score: number
  maxScore: number
  correct: string[]
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function normalizePickemFeed(value: unknown): PickemFeed | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.type === 'seed') {
    const seedValue = Number(raw.seed)
    return Number.isInteger(seedValue) && seedValue >= 1 ? { type: 'seed', seed: seedValue } : null
  }
  if (raw.type === 'winner' || raw.type === 'loser') {
    const of = stringOrNull(raw.of)
    return of ? { type: raw.type, of } : null
  }
  return null
}

export function normalizePickemStatus(value: unknown): PickemStatus {
  return typeof value === 'string' && ['draft', 'open', 'locked', 'scored'].includes(value)
    ? (value as PickemStatus)
    : 'draft'
}

export function normalizePickemFormat(value: unknown): PickemFormat {
  return value === 'matchups' ? 'matchups' : 'bracket'
}

export function normalizePickemSeeds(value: unknown): PickemSeed[] {
  const raw = Array.isArray(value) ? value : []
  return raw
    .map((seed): PickemSeed | null => {
      if (!seed || typeof seed !== 'object') return null
      const entry = seed as Record<string, unknown>
      const seedNumber = Number(entry.seed)
      const teamId = stringOrNull(entry.teamId)
      if (!Number.isInteger(seedNumber) || seedNumber < 1 || !teamId) return null
      return { seed: seedNumber, teamId }
    })
    .filter((seed): seed is PickemSeed => seed !== null)
    .sort((a, b) => a.seed - b.seed)
}

export function normalizePickemPayload(
  value: unknown,
  allowedSlotKeys?: Iterable<string>
): PickemPayload {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const rawPicks =
    raw.picks && typeof raw.picks === 'object' ? (raw.picks as Record<string, unknown>) : {}
  const allowed = allowedSlotKeys ? new Set(allowedSlotKeys) : null
  const picks: Record<string, string> = {}
  for (const [slotKey, teamId] of Object.entries(rawPicks)) {
    if (allowed && !allowed.has(slotKey)) continue
    const value = stringOrNull(teamId)
    if (value) picks[slotKey] = value
  }
  return { picks }
}

export function isPickemLocked(event: Pick<PickemEvent, 'status' | 'lockAt'>, now = new Date()) {
  if (event.status === 'locked' || event.status === 'scored') return true
  if (!event.lockAt) return false
  const lockAt = new Date(event.lockAt)
  return Number.isFinite(lockAt.getTime()) && lockAt.getTime() <= now.getTime()
}

/**
 * Resolve every unit's teams and picked winner.
 *
 * Units are walked in `sortOrder`, so a bracket's feeds always reference slots
 * that have already been resolved. Precedence, low to high: the user's payload
 * pick, a linked real match's winner, then an admin hard-resolved winner.
 */
export function buildPickemSlots(
  event: Pick<PickemEvent, 'seeds'>,
  matches: PickemMatch[],
  payload: PickemPayload = { picks: {} },
  linkedResults: Record<string, PickemLinkedResult> = {}
): PickemSlot[] {
  const sorted = [...matches].sort((a, b) => a.sortOrder - b.sortOrder)
  const seedMap = new Map(event.seeds.map((s) => [s.seed, s.teamId]))

  const picks: Record<string, string> = { ...payload.picks }
  for (const m of sorted) {
    const winnerId = linkedResults[m.slotKey]?.winnerId
    if (winnerId) picks[m.slotKey] = winnerId
  }
  for (const m of sorted) {
    if (m.actualWinnerId) picks[m.slotKey] = m.actualWinnerId
  }

  const bySlot = new Map<string, PickemSlot>()

  const resolveSide = (direct: string | null, feed: PickemFeed | null): string | null => {
    if (direct) return direct
    if (!feed) return null
    if (feed.type === 'seed') return seedMap.get(feed.seed) ?? null
    const ref = bySlot.get(feed.of)
    if (!ref) return null
    if (feed.type === 'winner') return ref.winnerId
    // loser
    if (!ref.winnerId || !ref.teamAId || !ref.teamBId) return null
    return ref.winnerId === ref.teamAId ? ref.teamBId : ref.teamAId
  }

  for (const m of sorted) {
    const link = linkedResults[m.slotKey]
    const teamAId = link?.teamAId ?? resolveSide(m.teamAId, m.feedA)
    const teamBId = link?.teamBId ?? resolveSide(m.teamBId, m.feedB)
    const picked = picks[m.slotKey] ?? null
    const winnerId = picked && (picked === teamAId || picked === teamBId) ? picked : null
    bySlot.set(m.slotKey, {
      id: m.slotKey,
      label: m.label,
      groupKey: m.groupKey,
      points: m.points,
      teamAId,
      teamBId,
      winnerId,
    })
  }

  return sorted.map((m) => bySlot.get(m.slotKey)!)
}

/**
 * Validate a submission: every undecided unit that has both teams needs a valid
 * winner pick. Admin hard-resolved units are skipped — they are worth no points
 * and are not the user's to pick.
 */
export function validatePickemPayload(
  event: Pick<PickemEvent, 'seeds'>,
  matches: PickemMatch[],
  payload: PickemPayload
): PickemPayload {
  const slots = buildPickemSlots(event, matches, payload)
  const actualById = new Map(matches.map((m) => [m.slotKey, m.actualWinnerId]))
  const picks: Record<string, string> = {}
  for (const slot of slots) {
    if (actualById.get(slot.id)) continue
    if (!slot.teamAId || !slot.teamBId) {
      throw new Error(`${slot.label} is missing teams`)
    }
    const pick = payload.picks[slot.id]
    if (!pick) throw new Error(`${slot.label} requires a winner pick`)
    if (pick !== slot.teamAId && pick !== slot.teamBId) {
      throw new Error(`${slot.label} winner must be one of the teams in that match`)
    }
    picks[slot.id] = pick
  }
  return { picks }
}

/**
 * Score a submission against the actual winners of completed linked matches.
 * Admin hard-resolved units (`actualWinnerId`) are excluded — they were decided
 * before the pick'em and carry no points.
 */
export function scorePickemPayload(
  matches: PickemMatch[],
  payload: PickemPayload,
  actualWinners: Record<string, string>
): PickemScoreResult {
  let score = 0
  let maxScore = 0
  const correct: string[] = []
  for (const m of matches) {
    if (m.actualWinnerId) continue
    const actual = actualWinners[m.slotKey]
    if (!actual) continue
    maxScore += m.points
    if (payload.picks[m.slotKey] === actual) {
      score += m.points
      correct.push(m.slotKey)
    }
  }
  return { score, maxScore, correct }
}

export function rankPickemLeaderboardEntries<
  T extends { score: number; submittedAt: string; user: { name: string } },
>(rows: T[]): Array<T & { rank: number }> {
  const sorted = [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const ta = new Date(a.submittedAt).getTime()
    const tb = new Date(b.submittedAt).getTime()
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb
    return a.user.name.localeCompare(b.user.name, undefined, { sensitivity: 'base' })
  })

  let currentRank = 1
  return sorted.map((row, i) => {
    if (i > 0 && row.score !== sorted[i - 1]!.score) currentRank = i + 1
    return { ...row, rank: currentRank }
  })
}

/**
 * A real match as result detection sees it. `winnerId` only counts once
 * `completed` is true.
 */
export type PickemRealMatch = {
  id: string
  teamAId: string
  teamBId: string
  winnerId: string | null
  completed: boolean
}

export type PickemResults = {
  /** Teams/winner per slot, from its manually linked or detected real match. */
  linkedResults: Record<string, PickemLinkedResult>
  /** Winners of completed real matches, keyed by slot — the scoreable results. */
  actualWinners: Record<string, string>
  /** Which real match decided each slot. */
  sourceMatchIds: Record<string, string>
}

/**
 * Work out every unit's real result without the admin linking each one.
 *
 * Units are walked in `sortOrder`. A unit with a manual link uses that match;
 * otherwise, once both its teams are known (assigned, seeded, or propagated
 * from earlier real results) it takes the earliest unused candidate between
 * that pair. Candidates must be in chronological order — that is what lets a
 * rematch (an upper final replayed in the grand final) land on the right unit,
 * since the later unit always depends on the earlier one.
 */
export function resolvePickemResults(
  event: Pick<PickemEvent, 'seeds'>,
  matches: PickemMatch[],
  real: { linked: Record<string, PickemRealMatch>; candidates: PickemRealMatch[] }
): PickemResults {
  const sorted = [...matches].sort((a, b) => a.sortOrder - b.sortOrder)
  const linkedResults: Record<string, PickemLinkedResult> = {}
  const actualWinners: Record<string, string> = {}
  const sourceMatchIds: Record<string, string> = {}
  const used = new Set(sorted.map((m) => m.linkedMatchId).filter(Boolean))

  for (const m of sorted) {
    let result: PickemLinkedResult | null = null
    let source: PickemRealMatch | undefined

    if (m.linkedMatchId) {
      source = real.linked[m.linkedMatchId]
      if (source) result = { teamAId: source.teamAId, teamBId: source.teamBId }
    } else {
      const slot = buildPickemSlots(event, sorted, { picks: {} }, linkedResults).find(
        (s) => s.id === m.slotKey
      )
      const a = slot?.teamAId
      const b = slot?.teamBId
      if (a && b) {
        source = real.candidates.find(
          (c) =>
            !used.has(c.id) &&
            ((c.teamAId === a && c.teamBId === b) || (c.teamAId === b && c.teamBId === a))
        )
        // Keep the bracket's own side order; the real match may list them swapped.
        if (source) result = { teamAId: a, teamBId: b }
      }
    }

    if (!source || !result) continue
    used.add(source.id)
    sourceMatchIds[m.slotKey] = source.id
    const winnerId = source.completed ? source.winnerId : null
    linkedResults[m.slotKey] = { ...result, winnerId }
    if (winnerId) actualWinners[m.slotKey] = winnerId
  }

  return { linkedResults, actualWinners, sourceMatchIds }
}

/** Every pickable unit has a real result — the pick'em is final. */
export function isPickemComplete(matches: PickemMatch[], actualWinners: Record<string, string>) {
  const pickable = matches.filter((m) => !m.actualWinnerId)
  return pickable.length > 0 && pickable.every((m) => Boolean(actualWinners[m.slotKey]))
}

/** The seeds that pick their quarter-final opponent; seeding stops here. */
export const DE8_TOP_SEEDS = [1, 2, 3, 4] as const

/**
 * Which upper quarter-final each top seed plays in. 1 and 4 share a half, as
 * do 2 and 3, so the top two seeds cannot meet before the upper final.
 */
export const DE8_QF_SLOT_BY_SEED: Record<number, string> = {
  1: 'ub_qf_1',
  4: 'ub_qf_2',
  2: 'ub_qf_3',
  3: 'ub_qf_4',
}

/** Each top seed's chosen opponent (seed → team id), read back from the QF rows. */
export function bracketOpponents(
  event: Pick<PickemEvent, 'seeds'>,
  matches: PickemMatch[]
): Record<number, string | null> {
  const slots = new Map(buildPickemSlots(event, matches).map((s) => [s.id, s]))
  const opponents: Record<number, string | null> = {}
  for (const seed of DE8_TOP_SEEDS) {
    opponents[seed] = slots.get(DE8_QF_SLOT_BY_SEED[seed]!)?.teamBId ?? null
  }
  return opponents
}

/**
 * Playoff seeds for every bracket team. Seeds 1–4 come from the config; the
 * four picked opponents take 5–8 in regular-season order, so the better
 * standings finisher holds the higher seed. Unranked teams fall in last.
 */
export function bracketSeedsWithOpponents(
  event: Pick<PickemEvent, 'seeds'>,
  matches: PickemMatch[],
  standings: Record<string, number>
): Record<string, number> {
  const seeds: Record<string, number> = {}
  for (const s of event.seeds) seeds[s.teamId] = s.seed
  const opponents = Object.values(bracketOpponents(event, matches)).filter(
    (id): id is string => Boolean(id) && seeds[id!] == null
  )
  const rank = (id: string) => standings[id] ?? Number.POSITIVE_INFINITY
  opponents
    .map((id, i) => ({ id, i }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i)
    .forEach(({ id }, i) => (seeds[id] = DE8_TOP_SEEDS.length + 1 + i))
  return seeds
}

/**
 * The canonical 8-team, single-QF double-elimination template. Seeds 1–4 sit
 * on side A of their QF; side B is the opponent each one picked, or — when
 * none is given — the default 1v8 / 4v5 / 2v7 / 3v6 seed pairing (kept for
 * brackets saved before opponents were picked).
 */
export function standardDoubleElim8Template(
  opponents: Record<number, string | null> = {}
): PickemMatch[] {
  const seed = (n: number): PickemFeed => ({ type: 'seed', seed: n })
  const win = (of: string): PickemFeed => ({ type: 'winner', of })
  const lose = (of: string): PickemFeed => ({ type: 'loser', of })

  const rows: Array<
    Pick<PickemMatch, 'slotKey' | 'groupKey' | 'label' | 'points' | 'feedA' | 'feedB'>
  > = [
    {
      slotKey: 'ub_qf_1',
      groupKey: 'Upper QF',
      label: 'Upper QF 1',
      points: 1,
      feedA: seed(1),
      feedB: seed(8),
    },
    {
      slotKey: 'ub_qf_2',
      groupKey: 'Upper QF',
      label: 'Upper QF 2',
      points: 1,
      feedA: seed(4),
      feedB: seed(5),
    },
    {
      slotKey: 'ub_qf_3',
      groupKey: 'Upper QF',
      label: 'Upper QF 3',
      points: 1,
      feedA: seed(2),
      feedB: seed(7),
    },
    {
      slotKey: 'ub_qf_4',
      groupKey: 'Upper QF',
      label: 'Upper QF 4',
      points: 1,
      feedA: seed(3),
      feedB: seed(6),
    },
    {
      slotKey: 'ub_sf_1',
      groupKey: 'Upper SF',
      label: 'Upper SF 1',
      points: 2,
      feedA: win('ub_qf_1'),
      feedB: win('ub_qf_2'),
    },
    {
      slotKey: 'ub_sf_2',
      groupKey: 'Upper SF',
      label: 'Upper SF 2',
      points: 2,
      feedA: win('ub_qf_3'),
      feedB: win('ub_qf_4'),
    },
    {
      slotKey: 'ub_final',
      groupKey: 'Upper Final',
      label: 'Upper Final',
      points: 3,
      feedA: win('ub_sf_1'),
      feedB: win('ub_sf_2'),
    },
    {
      slotKey: 'lb_r1_1',
      groupKey: 'Lower R1',
      label: 'Lower R1 1',
      points: 2,
      feedA: lose('ub_qf_1'),
      feedB: lose('ub_qf_2'),
    },
    {
      slotKey: 'lb_r1_2',
      groupKey: 'Lower R1',
      label: 'Lower R1 2',
      points: 2,
      feedA: lose('ub_qf_3'),
      feedB: lose('ub_qf_4'),
    },
    {
      slotKey: 'lb_r2_1',
      groupKey: 'Lower R2',
      label: 'Lower R2 1',
      points: 2,
      // Upper SF losers cross over to the other half of the lower bracket, so
      // they never meet a team from their own QF pair straight away.
      feedA: lose('ub_sf_2'),
      feedB: win('lb_r1_1'),
    },
    {
      slotKey: 'lb_r2_2',
      groupKey: 'Lower R2',
      label: 'Lower R2 2',
      points: 2,
      feedA: lose('ub_sf_1'),
      feedB: win('lb_r1_2'),
    },
    {
      slotKey: 'lb_r3',
      groupKey: 'Lower R3',
      label: 'Lower Round 3',
      points: 2,
      feedA: win('lb_r2_1'),
      feedB: win('lb_r2_2'),
    },
    {
      slotKey: 'lb_final',
      groupKey: 'Lower Final',
      label: 'Lower Final',
      points: 3,
      feedA: lose('ub_final'),
      feedB: win('lb_r3'),
    },
    {
      slotKey: 'grand_final',
      groupKey: 'Grand Final',
      label: 'Grand Final',
      points: 5,
      feedA: win('ub_final'),
      feedB: win('lb_final'),
    },
  ]

  return rows.map((row, i) => {
    const topSeed = row.feedA?.type === 'seed' ? row.feedA.seed : null
    const opponent = topSeed != null ? (opponents[topSeed] ?? null) : null
    return {
      ...row,
      sortOrder: i,
      teamAId: null,
      teamBId: opponent,
      feedB: opponent ? null : row.feedB,
      linkedMatchId: null,
      actualWinnerId: null,
    }
  })
}

/**
 * The team(s) that finished 3rd in a decided bracket, read off its topology.
 *
 * A slot labelled as a 3rd-place match settles it outright. Otherwise 3rd goes
 * to whoever was knocked out deepest without reaching the final: a slot whose
 * loser is not fed anywhere eliminates that loser, and the deepest such slot
 * short of the final is the last elimination before it — the Lower Final in a
 * double-elim bracket. In single elimination both semi-final losers sit at the
 * same depth, so they share 3rd.
 *
 * Returns an empty list until that slot has a winner.
 */
export function bracketThirdPlaceTeamIds(matches: PickemMatch[], slots: PickemSlot[]): string[] {
  const slotById = new Map(slots.map((s) => [s.id, s]))
  const loserOf = (slot: PickemSlot | undefined) =>
    slot?.winnerId && slot.teamAId && slot.teamBId
      ? slot.winnerId === slot.teamAId
        ? slot.teamBId
        : slot.teamAId
      : null

  const isThirdPlaceMatch = (m: PickemMatch) => /\b(3rd|third)\b/i.test(`${m.slotKey} ${m.label}`)
  const thirdPlaceMatch = matches.find(isThirdPlaceMatch)
  if (thirdPlaceMatch) {
    const winner = slotById.get(thirdPlaceMatch.slotKey)?.winnerId
    return winner ? [winner] : []
  }

  // Longest path from the seeds, walked in sort order so feeds resolve first.
  const sorted = [...matches].sort((a, b) => a.sortOrder - b.sortOrder)
  const depth = new Map<string, number>()
  const winnerFed = new Set<string>()
  const loserFed = new Set<string>()
  for (const m of sorted) {
    let d = 0
    for (const feed of [m.feedA, m.feedB]) {
      if (!feed || feed.type === 'seed') continue
      ;(feed.type === 'winner' ? winnerFed : loserFed).add(feed.of)
      d = Math.max(d, depth.get(feed.of) ?? 0)
    }
    depth.set(m.slotKey, d + 1)
  }

  // The final is the deepest slot whose result goes nowhere.
  const terminal = sorted.filter((m) => !winnerFed.has(m.slotKey) && !loserFed.has(m.slotKey))
  if (terminal.length === 0) return []
  const final = terminal.reduce((a, b) => (depth.get(b.slotKey)! > depth.get(a.slotKey)! ? b : a))

  const eliminations = sorted.filter((m) => m !== final && !loserFed.has(m.slotKey))
  if (eliminations.length === 0) return []
  const deepest = Math.max(...eliminations.map((m) => depth.get(m.slotKey)!))
  const losers = eliminations
    .filter((m) => depth.get(m.slotKey) === deepest)
    .map((m) => loserOf(slotById.get(m.slotKey)))

  // Every slot at that depth has to be decided, or 3rd is not settled yet.
  return losers.every(Boolean) ? (losers as string[]) : []
}

/** Slot keys of the standard bracket, in display order. */
export const STANDARD_DE8_SLOT_KEYS = standardDoubleElim8Template().map((m) => m.slotKey)
