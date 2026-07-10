export const PLAYOFF_PICKEM_KIND = 'playoff_bracket' as const

export const PLAYOFF_MATCH_IDS = [
  'ub_qf_1',
  'ub_qf_2',
  'ub_qf_3',
  'ub_qf_4',
  'ub_sf_1',
  'ub_sf_2',
  'ub_final',
  'lb_r1_1',
  'lb_r1_2',
  'lb_r2_1',
  'lb_r2_2',
  'lb_r3',
  'lb_final',
  'grand_final',
] as const

export type PlayoffMatchId = (typeof PLAYOFF_MATCH_IDS)[number]
export type PlayoffPickemStatus = 'draft' | 'open' | 'locked' | 'scored'

export type PlayoffPickemTeam = {
  id: string
  name: string
  tag: string | null
  logo_url?: string | null
}

export type PlayoffPickemSeed = {
  seed: number
  teamId: string
}

export type PlayoffPickemMatchLink = {
  matchId: PlayoffMatchId
  actualMatchId: string | null
}

export type PlayoffPickemMatchup = {
  matchId: 'ub_qf_1' | 'ub_qf_2' | 'ub_qf_3' | 'ub_qf_4'
  seedA: number
  seedB: number
}

export type PlayoffPickemResolvedMatch = {
  matchId: PlayoffMatchId
  winnerId: string
}

export type PlayoffPickemConfig = {
  enabled: boolean
  status: PlayoffPickemStatus
  lock_at: string | null
  seeds: PlayoffPickemSeed[]
  matchups: PlayoffPickemMatchup[]
  match_links: PlayoffPickemMatchLink[]
  resolved_matches: PlayoffPickemResolvedMatch[]
}

export type PlayoffPickemPayload = {
  picks: Partial<Record<PlayoffMatchId, string>>
}

export type PlayoffPickemSlot = {
  id: PlayoffMatchId
  label: string
  bracket: 'upper' | 'lower' | 'final'
  round: number
  points: number
  teamAId: string | null
  teamBId: string | null
  winnerId: string | null
}

export type PlayoffPickemScoreResult = {
  score: number
  maxScore: number
  correct: PlayoffMatchId[]
}

const MATCH_POINTS: Record<PlayoffMatchId, number> = {
  ub_qf_1: 1,
  ub_qf_2: 1,
  ub_qf_3: 1,
  ub_qf_4: 1,
  ub_sf_1: 2,
  ub_sf_2: 2,
  ub_final: 3,
  lb_r1_1: 2,
  lb_r1_2: 2,
  lb_r2_1: 2,
  lb_r2_2: 2,
  lb_r3: 2,
  lb_final: 3,
  grand_final: 5,
}

export const MATCH_LABELS: Record<PlayoffMatchId, string> = {
  ub_qf_1: 'Upper QF 1',
  ub_qf_2: 'Upper QF 2',
  ub_qf_3: 'Upper QF 3',
  ub_qf_4: 'Upper QF 4',
  ub_sf_1: 'Upper SF 1',
  ub_sf_2: 'Upper SF 2',
  ub_final: 'Upper Final',
  lb_r1_1: 'Lower R1 1',
  lb_r1_2: 'Lower R1 2',
  lb_r2_1: 'Lower R2 1',
  lb_r2_2: 'Lower R2 2',
  lb_r3: 'Lower Round 3',
  lb_final: 'Lower Final',
  grand_final: 'Grand Final',
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeStatus(value: unknown): PlayoffPickemStatus {
  return typeof value === 'string' && ['draft', 'open', 'locked', 'scored'].includes(value)
    ? (value as PlayoffPickemStatus)
    : 'draft'
}

export function normalizePlayoffPickemConfig(value: unknown): PlayoffPickemConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const rawSeeds = Array.isArray(raw.seeds) ? raw.seeds : []
  const seeds = rawSeeds
    .map((seed): PlayoffPickemSeed | null => {
      if (!seed || typeof seed !== 'object') return null
      const entry = seed as Record<string, unknown>
      const seedNumber = Number(entry.seed)
      const teamId = stringOrNull(entry.teamId)
      if (!Number.isInteger(seedNumber) || seedNumber < 1 || seedNumber > 8 || !teamId) return null
      return { seed: seedNumber, teamId }
    })
    .filter((seed): seed is PlayoffPickemSeed => seed !== null)
    .sort((a, b) => a.seed - b.seed)

  const qfIds: PlayoffPickemMatchup['matchId'][] = ['ub_qf_1', 'ub_qf_2', 'ub_qf_3', 'ub_qf_4']
  const rawMatchups = Array.isArray(raw.matchups) ? raw.matchups : []
  const matchups: PlayoffPickemMatchup[] = qfIds.map((matchId, i) => {
    const found = rawMatchups.find(
      (m: unknown) =>
        m && typeof m === 'object' && (m as Record<string, unknown>).matchId === matchId
    ) as Record<string, unknown> | undefined
    if (found) {
      const seedA = Number(found.seedA)
      const seedB = Number(found.seedB)
      if (
        Number.isInteger(seedA) &&
        seedA >= 1 &&
        seedA <= 8 &&
        Number.isInteger(seedB) &&
        seedB >= 1 &&
        seedB <= 8
      ) {
        return { matchId, seedA, seedB }
      }
    }
    const defaults: [number, number][] = [
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]
    return { matchId, seedA: defaults[i][0], seedB: defaults[i][1] }
  })

  const rawLinks = Array.isArray(raw.match_links) ? raw.match_links : []
  const linkByMatch = new Map<string, string | null>()
  for (const link of rawLinks) {
    if (!link || typeof link !== 'object') continue
    const entry = link as Record<string, unknown>
    const matchId = stringOrNull(entry.matchId)
    if (!matchId || !PLAYOFF_MATCH_IDS.includes(matchId as PlayoffMatchId)) continue
    linkByMatch.set(matchId, stringOrNull(entry.actualMatchId))
  }

  const rawResolved = Array.isArray(raw.resolved_matches) ? raw.resolved_matches : []
  const resolved_matches: PlayoffPickemResolvedMatch[] = rawResolved
    .map((entry: unknown): PlayoffPickemResolvedMatch | null => {
      if (!entry || typeof entry !== 'object') return null
      const e = entry as Record<string, unknown>
      const matchId = stringOrNull(e.matchId)
      const winnerId = stringOrNull(e.winnerId)
      if (!matchId || !winnerId || !PLAYOFF_MATCH_IDS.includes(matchId as PlayoffMatchId))
        return null
      return { matchId: matchId as PlayoffMatchId, winnerId }
    })
    .filter((e): e is PlayoffPickemResolvedMatch => e !== null)

  return {
    enabled: Boolean(raw.enabled),
    status: normalizeStatus(raw.status),
    lock_at: stringOrNull(raw.lock_at),
    seeds,
    matchups,
    match_links: PLAYOFF_MATCH_IDS.map((matchId) => ({
      matchId,
      actualMatchId: linkByMatch.get(matchId) ?? null,
    })),
    resolved_matches,
  }
}

export function playoffPickemConfigFromSeasonMetadata(metadata: unknown): PlayoffPickemConfig {
  const raw =
    metadata && typeof metadata === 'object'
      ? (metadata as Record<string, unknown>).playoff_pickem
      : undefined
  return normalizePlayoffPickemConfig(raw)
}

export function normalizePlayoffPickemPayload(value: unknown): PlayoffPickemPayload {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const rawPicks =
    raw.picks && typeof raw.picks === 'object' ? (raw.picks as Record<string, unknown>) : {}
  const picks: Partial<Record<PlayoffMatchId, string>> = {}
  for (const matchId of PLAYOFF_MATCH_IDS) {
    const teamId = stringOrNull(rawPicks[matchId])
    if (teamId) picks[matchId] = teamId
  }
  return { picks }
}

export function isPlayoffPickemLocked(config: PlayoffPickemConfig, now = new Date()) {
  if (config.status === 'locked' || config.status === 'scored') return true
  if (!config.lock_at) return false
  const lockAt = new Date(config.lock_at)
  return Number.isFinite(lockAt.getTime()) && lockAt.getTime() <= now.getTime()
}

export function validatePlayoffPickemConfig(config: PlayoffPickemConfig) {
  if (config.seeds.length !== 8) throw new Error('Playoff pickem requires exactly 8 seeds')
  const seedNumbers = new Set<number>()
  const teamIds = new Set<string>()
  for (const seed of config.seeds) {
    if (seedNumbers.has(seed.seed)) throw new Error('Each seed number must be unique')
    if (teamIds.has(seed.teamId)) throw new Error('Each playoff team must be unique')
    seedNumbers.add(seed.seed)
    teamIds.add(seed.teamId)
  }
  for (let seed = 1; seed <= 8; seed += 1) {
    if (!seedNumbers.has(seed)) throw new Error('Playoff seeds must include 1 through 8')
  }
}

function getSeed(config: PlayoffPickemConfig, seed: number) {
  return config.seeds.find((entry) => entry.seed === seed)?.teamId ?? null
}

function winner(picks: Partial<Record<PlayoffMatchId, string>>, matchId: PlayoffMatchId) {
  return picks[matchId] ?? null
}

function loser(slot: PlayoffPickemSlot) {
  if (!slot.winnerId || !slot.teamAId || !slot.teamBId) return null
  if (slot.winnerId === slot.teamAId) return slot.teamBId
  if (slot.winnerId === slot.teamBId) return slot.teamAId
  return null
}

function makeSlot(
  id: PlayoffMatchId,
  bracket: PlayoffPickemSlot['bracket'],
  round: number,
  teamAId: string | null,
  teamBId: string | null,
  picks: Partial<Record<PlayoffMatchId, string>>
): PlayoffPickemSlot {
  const picked = winner(picks, id)
  const winnerId = picked && (picked === teamAId || picked === teamBId) ? picked : null
  return {
    id,
    label: MATCH_LABELS[id],
    bracket,
    round,
    points: MATCH_POINTS[id],
    teamAId,
    teamBId,
    winnerId,
  }
}

export function buildPlayoffBracketSlots(
  config: PlayoffPickemConfig,
  payload: PlayoffPickemPayload = { picks: {} }
): PlayoffPickemSlot[] {
  const resolvedMap = new Map(config.resolved_matches?.map((r) => [r.matchId, r.winnerId]) ?? [])
  const picks: Partial<Record<PlayoffMatchId, string>> = { ...payload.picks }
  for (const [matchId, winnerId] of resolvedMap) {
    picks[matchId] = winnerId
  }
  const defaults: PlayoffPickemMatchup[] = [
    { matchId: 'ub_qf_1', seedA: 1, seedB: 8 },
    { matchId: 'ub_qf_2', seedA: 4, seedB: 5 },
    { matchId: 'ub_qf_3', seedA: 2, seedB: 7 },
    { matchId: 'ub_qf_4', seedA: 3, seedB: 6 },
  ]
  const mu = config.matchups?.length === 4 ? config.matchups : defaults
  const qf1 = makeSlot(
    'ub_qf_1',
    'upper',
    1,
    getSeed(config, mu[0].seedA),
    getSeed(config, mu[0].seedB),
    picks
  )
  const qf2 = makeSlot(
    'ub_qf_2',
    'upper',
    1,
    getSeed(config, mu[1].seedA),
    getSeed(config, mu[1].seedB),
    picks
  )
  const qf3 = makeSlot(
    'ub_qf_3',
    'upper',
    1,
    getSeed(config, mu[2].seedA),
    getSeed(config, mu[2].seedB),
    picks
  )
  const qf4 = makeSlot(
    'ub_qf_4',
    'upper',
    1,
    getSeed(config, mu[3].seedA),
    getSeed(config, mu[3].seedB),
    picks
  )
  const sf1 = makeSlot('ub_sf_1', 'upper', 2, qf1.winnerId, qf2.winnerId, picks)
  const sf2 = makeSlot('ub_sf_2', 'upper', 2, qf3.winnerId, qf4.winnerId, picks)
  const uf = makeSlot('ub_final', 'upper', 3, sf1.winnerId, sf2.winnerId, picks)
  const lb1 = makeSlot('lb_r1_1', 'lower', 1, loser(qf1), loser(qf2), picks)
  const lb2 = makeSlot('lb_r1_2', 'lower', 1, loser(qf3), loser(qf4), picks)
  const lb3 = makeSlot('lb_r2_1', 'lower', 2, loser(sf2), lb1.winnerId, picks)
  const lb4 = makeSlot('lb_r2_2', 'lower', 2, loser(sf1), lb2.winnerId, picks)
  const lb5 = makeSlot('lb_r3', 'lower', 3, lb3.winnerId, lb4.winnerId, picks)
  const lf = makeSlot('lb_final', 'lower', 4, loser(uf), lb5.winnerId, picks)
  const gf = makeSlot('grand_final', 'final', 4, uf.winnerId, lf.winnerId, picks)
  return [qf1, qf2, qf3, qf4, sf1, sf2, uf, lb1, lb2, lb3, lb4, lb5, lf, gf]
}

export function validatePlayoffPickemPayload(
  config: PlayoffPickemConfig,
  payload: PlayoffPickemPayload
) {
  validatePlayoffPickemConfig(config)
  const resolvedIds = new Set(config.resolved_matches.map((r) => r.matchId))
  const slots = buildPlayoffBracketSlots(config, payload)
  for (const slot of slots) {
    if (resolvedIds.has(slot.id)) continue
    if (!slot.teamAId || !slot.teamBId) {
      throw new Error(`${slot.label} is missing teams`)
    }
    const pick = payload.picks[slot.id]
    if (!pick) throw new Error(`${slot.label} requires a winner pick`)
    if (pick !== slot.teamAId && pick !== slot.teamBId) {
      throw new Error(`${slot.label} winner must be one of the teams in that match`)
    }
  }
  return {
    picks: Object.fromEntries(
      slots
        .filter((slot) => !resolvedIds.has(slot.id))
        .map((slot) => [slot.id, payload.picks[slot.id]!])
    ) as Record<PlayoffMatchId, string>,
  }
}

export function scorePlayoffPickemPayload(
  payload: PlayoffPickemPayload,
  actualWinners: Partial<Record<PlayoffMatchId, string>>,
  resolvedMatchIds: Set<PlayoffMatchId> = new Set()
): PlayoffPickemScoreResult {
  let score = 0
  let maxScore = 0
  const correct: PlayoffMatchId[] = []
  for (const matchId of PLAYOFF_MATCH_IDS) {
    if (resolvedMatchIds.has(matchId)) continue
    const actual = actualWinners[matchId]
    if (!actual) continue
    maxScore += MATCH_POINTS[matchId]
    if (payload.picks[matchId] === actual) {
      score += MATCH_POINTS[matchId]
      correct.push(matchId)
    }
  }
  return { score, maxScore, correct }
}

export function rankPlayoffLeaderboardEntries<
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
