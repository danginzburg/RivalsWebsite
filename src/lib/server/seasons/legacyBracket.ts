import {
  buildPickemSlots,
  standardDoubleElim8Template,
  type PickemLinkedResult,
  type PickemMatch,
  type PickemSeed,
  type PickemSlot,
} from '$lib/pickems'
import { supabaseAdmin } from '$lib/supabase/admin'

/**
 * Legacy playoff bracket reader.
 *
 * Before the pick'em rework, a season's playoff bracket lived in
 * `seasons.metadata.playoff_pickem` (seeds + QF matchups + links to real
 * matches + admin-resolved winners), not in the `pickem_events` /
 * `pickem_matches` tables the new engine reads. Archived seasons still carry
 * that metadata, so the events page rebuilds their bracket from it whenever the
 * new pick'em has no bracket of its own — otherwise those brackets vanish.
 *
 * Rather than reimplement bracket propagation, this translates the legacy blob
 * into the same inputs the live engine takes — the standard 8-team
 * double-elim template, seeds, linked-match results, and admin-resolved winners
 * — and calls `buildPickemSlots`. That matters: an archived lower bracket can be
 * re-routed differently than the template (a loser sent to a different slot), so
 * the slot teams must come from the linked real matches, not from seed routing,
 * or the wrong names show. The live engine already does this via
 * `PickemLinkedResult`; reusing it keeps legacy and native brackets identical.
 */

const MATCH_IDS = [
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

type MatchId = (typeof MATCH_IDS)[number]

const QF_IDS: MatchId[] = ['ub_qf_1', 'ub_qf_2', 'ub_qf_3', 'ub_qf_4']

const DEFAULT_MATCHUPS: Array<{ matchId: MatchId; seedA: number; seedB: number }> = [
  { matchId: 'ub_qf_1', seedA: 1, seedB: 8 },
  { matchId: 'ub_qf_2', seedA: 4, seedB: 5 },
  { matchId: 'ub_qf_3', seedA: 2, seedB: 7 },
  { matchId: 'ub_qf_4', seedA: 3, seedB: 6 },
]

type LegacySeed = { seed: number; teamId: string }

type LegacyConfig = {
  seeds: LegacySeed[]
  matchups: Array<{ matchId: MatchId; seedA: number; seedB: number }>
  matchLinks: Array<{ matchId: MatchId; actualMatchId: string | null }>
  resolved: Array<{ matchId: MatchId; winnerId: string }>
}

export type LegacyBracket = {
  slots: PickemSlot[]
  /** Seed number keyed by team id, for seed labels across the page. */
  seeds: Record<string, number>
  /** How many teams were seeded into the bracket. */
  teamCount: number
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isMatchId(value: string): value is MatchId {
  return (MATCH_IDS as readonly string[]).includes(value)
}

/** Parse the `playoff_pickem` blob off a season's metadata. */
function parseConfig(metadata: unknown): LegacyConfig {
  const meta = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {}
  const raw =
    meta.playoff_pickem && typeof meta.playoff_pickem === 'object'
      ? (meta.playoff_pickem as Record<string, unknown>)
      : {}

  const seeds = (Array.isArray(raw.seeds) ? raw.seeds : [])
    .map((seed): LegacySeed | null => {
      if (!seed || typeof seed !== 'object') return null
      const entry = seed as Record<string, unknown>
      const seedNumber = Number(entry.seed)
      const teamId = stringOrNull(entry.teamId)
      if (!Number.isInteger(seedNumber) || seedNumber < 1 || seedNumber > 8 || !teamId) return null
      return { seed: seedNumber, teamId }
    })
    .filter((seed): seed is LegacySeed => seed !== null)
    .sort((a, b) => a.seed - b.seed)

  const rawMatchups = Array.isArray(raw.matchups) ? raw.matchups : []
  const matchups = DEFAULT_MATCHUPS.map((fallback) => {
    const found = rawMatchups.find(
      (m: unknown) =>
        m && typeof m === 'object' && (m as Record<string, unknown>).matchId === fallback.matchId
    ) as Record<string, unknown> | undefined
    const seedA = Number(found?.seedA)
    const seedB = Number(found?.seedB)
    if (seedA >= 1 && seedA <= 8 && seedB >= 1 && seedB <= 8) {
      return { matchId: fallback.matchId, seedA, seedB }
    }
    return fallback
  })

  const matchLinks = (Array.isArray(raw.match_links) ? raw.match_links : [])
    .map((link): { matchId: MatchId; actualMatchId: string | null } | null => {
      if (!link || typeof link !== 'object') return null
      const entry = link as Record<string, unknown>
      const matchId = stringOrNull(entry.matchId)
      if (!matchId || !isMatchId(matchId)) return null
      return { matchId, actualMatchId: stringOrNull(entry.actualMatchId) }
    })
    .filter((link): link is { matchId: MatchId; actualMatchId: string | null } => link !== null)

  const resolved = (Array.isArray(raw.resolved_matches) ? raw.resolved_matches : [])
    .map((entry): { matchId: MatchId; winnerId: string } | null => {
      if (!entry || typeof entry !== 'object') return null
      const e = entry as Record<string, unknown>
      const matchId = stringOrNull(e.matchId)
      const winnerId = stringOrNull(e.winnerId)
      if (!matchId || !winnerId || !isMatchId(matchId)) return null
      return { matchId, winnerId }
    })
    .filter((entry): entry is { matchId: MatchId; winnerId: string } => entry !== null)

  return { seeds, matchups, matchLinks, resolved }
}

/**
 * Build the pick'em match rows for a legacy bracket: the standard double-elim
 * template with the season's own QF seed pairings and each slot's linked match
 * / resolved winner filled in from the config.
 */
function toPickemMatches(config: LegacyConfig): PickemMatch[] {
  const qfSeeds = new Map(config.matchups.map((m) => [m.matchId, m]))
  const linkByMatch = new Map(config.matchLinks.map((l) => [l.matchId, l.actualMatchId]))
  const resolvedByMatch = new Map(config.resolved.map((r) => [r.matchId, r.winnerId]))

  return standardDoubleElim8Template().map((match) => {
    const slotKey = match.slotKey as MatchId
    // QF teams come from this season's seed pairings, which can differ from the
    // template's default (e.g. 1v8/4v7/2v6/3v5 instead of 1v8/4v5/2v7/3v6).
    const qf = QF_IDS.includes(slotKey) ? qfSeeds.get(slotKey) : undefined
    return {
      ...match,
      feedA: qf ? { type: 'seed', seed: qf.seedA } : match.feedA,
      feedB: qf ? { type: 'seed', seed: qf.seedB } : match.feedB,
      linkedMatchId: linkByMatch.get(slotKey) ?? null,
      actualWinnerId: resolvedByMatch.get(slotKey) ?? null,
    }
  })
}

/**
 * Teams and winner of each slot's linked real match, keyed by slot key. The
 * server equivalent of the live engine's `getLinkedResults`: a slot's teams
 * come from the real match it is linked to, so a re-routed bracket shows the
 * teams that actually played. Links pointing at a deleted match are skipped.
 */
async function loadLinkedResults(
  matches: PickemMatch[]
): Promise<Record<string, PickemLinkedResult>> {
  const linkedIds = matches.map((m) => m.linkedMatchId).filter((id): id is string => Boolean(id))
  if (linkedIds.length === 0) return {}

  const { data } = await supabaseAdmin
    .from('matches')
    .select('id, team_a_id, team_b_id, winner_team_id')
    .in('id', linkedIds)

  const byId = new Map(
    (data ?? []).map(
      (m: {
        id: string
        team_a_id: string | null
        team_b_id: string | null
        winner_team_id: string | null
      }) => [m.id, m]
    )
  )

  const results: Record<string, PickemLinkedResult> = {}
  for (const match of matches) {
    if (!match.linkedMatchId) continue
    const real = byId.get(match.linkedMatchId)
    if (!real) continue
    results[match.slotKey] = {
      teamAId: real.team_a_id ?? null,
      teamBId: real.team_b_id ?? null,
      winnerId: real.winner_team_id ?? null,
    }
  }
  return results
}

/**
 * Rebuild an archived season's bracket from its legacy metadata. Returns `null`
 * when the season has no seeded legacy bracket (nothing to fall back to).
 *
 * The old `enabled` flag is intentionally ignored: it gated the *live*
 * prediction game, not the archived results, and was switched off for every
 * season when the feature was deprecated. A seeded bracket is shown regardless
 * so finished brackets keep appearing on the archive.
 *
 * Winners come from the real matches each slot is linked to, with any
 * admin-resolved winners layered on top — the same precedence the live engine
 * uses, so a reconstructed bracket shows its true results, not TBD.
 */
export async function loadLegacyBracket(metadata: unknown): Promise<LegacyBracket | null> {
  const config = parseConfig(metadata)
  if (config.seeds.length === 0) return null

  const matches = toPickemMatches(config)
  const linkedResults = await loadLinkedResults(matches)
  const seeds: PickemSeed[] = config.seeds.map((s) => ({ seed: s.seed, teamId: s.teamId }))

  return {
    slots: buildPickemSlots({ seeds }, matches, { picks: {} }, linkedResults),
    seeds: Object.fromEntries(config.seeds.map((s) => [s.teamId, s.seed])),
    teamCount: config.seeds.length,
  }
}
