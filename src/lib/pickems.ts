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
 * The canonical 8-team, single-QF double-elimination template. `Generate` in
 * the admin writes these rows (teams left to seeds/propagation). Default QF
 * pairing is 1v8 / 4v5 / 2v7 / 3v6.
 */
export function standardDoubleElim8Template(): PickemMatch[] {
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
      feedA: lose('ub_sf_1'),
      feedB: win('lb_r1_1'),
    },
    {
      slotKey: 'lb_r2_2',
      groupKey: 'Lower R2',
      label: 'Lower R2 2',
      points: 2,
      feedA: lose('ub_sf_2'),
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

  return rows.map((row, i) => ({
    ...row,
    sortOrder: i,
    teamAId: null,
    teamBId: null,
    linkedMatchId: null,
    actualWinnerId: null,
  }))
}

/** Slot keys of the standard bracket, in display order. */
export const STANDARD_DE8_SLOT_KEYS = standardDoubleElim8Template().map((m) => m.slotKey)
