/**
 * Pure rank summary over HenrikDev's v3 MMR payload, kept apart from the
 * transport so it can be tested without network access.
 *
 * Only acts from V26 Act 1 onward count. Henrik labels acts by the old
 * episode numbering, so V26 Act 1 is "e11a1" (verified 2026-10-27 against a
 * live response: Riot season 3ea2b318…, which starts 2026-01-07). The
 * `seasonal` list it returns is chronological, oldest first.
 */

/** First act whose ranks count: V26 Act 1. */
export const RANK_WINDOW_START = { episode: 11, act: 1 } as const

/** Riot tier ids below this are Unrated / unused placeholders. */
const FIRST_RANKED_TIER = 3

export type Tier = { id: number; name: string }

export type MmrSeasonal = {
  season?: { id?: string | null; short?: string | null } | null
  games?: number | null
  end_tier?: Partial<Tier> | null
  act_wins?: Array<Partial<Tier> | null> | null
}

export type MmrV3Payload = {
  account?: { name?: string | null; tag?: string | null; puuid?: string | null } | null
  current?: {
    tier?: Partial<Tier> | null
    rr?: number | null
  } | null
  seasonal?: MmrSeasonal[] | null
}

export type RankSummary = {
  currentTier: Tier | null
  currentRr: number | null
  /**
   * Where the current rank came from: the live rank, or — when the player has
   * no live rank — the end rank of their most recent ranked act in the window.
   */
  currentSource: 'current' | 'last-act' | null
  /** Act label the fallback current rank came from, e.g. "V26 A4". */
  currentAct: string | null
  /** Highest tier reached in any act since V26 Act 1. */
  peakTier: Tier | null
  peakAct: string | null
}

/** Parse Henrik's "e11a4" act code. */
export function parseActCode(short: string | null | undefined) {
  const match = /^e(\d+)a(\d+)$/i.exec(String(short ?? '').trim())
  if (!match) return null
  return { episode: Number(match[1]), act: Number(match[2]) }
}

export function isInRankWindow(short: string | null | undefined): boolean {
  const code = parseActCode(short)
  if (!code) return false
  if (code.episode !== RANK_WINDOW_START.episode) return code.episode > RANK_WINDOW_START.episode
  return code.act >= RANK_WINDOW_START.act
}

/**
 * Label an act the way the game now does. Riot renamed episodes to years in
 * 2025, so Henrik's episode 10 is V25 and episode 11 is V26.
 */
export function actLabel(short: string | null | undefined): string | null {
  const code = parseActCode(short)
  if (!code) return short ?? null
  return `V${code.episode + 15} A${code.act}`
}

function rankedTier(tier: Partial<Tier> | null | undefined): Tier | null {
  const id = Number(tier?.id)
  if (!Number.isFinite(id) || id < FIRST_RANKED_TIER || !tier?.name) return null
  return { id, name: tier.name }
}

/** Highest tier the player reached in one act: their wins and their end rank. */
function actPeak(act: MmrSeasonal): Tier | null {
  let best: Tier | null = null
  for (const candidate of [...(act.act_wins ?? []), act.end_tier]) {
    const tier = rankedTier(candidate)
    if (tier && (!best || tier.id > best.id)) best = tier
  }
  return best
}

export function summarizeRank(payload: MmrV3Payload): RankSummary {
  const acts = (payload.seasonal ?? []).filter(
    (act) => isInRankWindow(act.season?.short) && Number(act.games ?? 0) > 0
  )

  let currentTier: Tier | null = null
  let currentRr: number | null = null
  let currentSource: RankSummary['currentSource'] = null
  let currentAct: string | null = null

  // The live rank only counts if the player has played in the window — a
  // stale rank from years ago is not "current".
  const live = rankedTier(payload.current?.tier)
  if (live && acts.length > 0) {
    currentTier = live
    currentRr = payload.current?.rr ?? null
    currentSource = 'current'
  } else {
    // Unrated now (placements, or just not played): use the newest act in the
    // window that ended with a rank.
    for (const act of [...acts].reverse()) {
      const end = rankedTier(act.end_tier)
      if (!end) continue
      currentTier = end
      currentSource = 'last-act'
      currentAct = actLabel(act.season?.short)
      break
    }
  }

  let peakTier: Tier | null = null
  let peakAct: string | null = null
  for (const act of acts) {
    const tier = actPeak(act)
    // Strictly greater keeps the earliest act the peak was first reached in.
    if (tier && (!peakTier || tier.id > peakTier.id)) {
      peakTier = tier
      peakAct = actLabel(act.season?.short)
    }
  }

  // The live rank can be above anything recorded in the act list yet.
  if (currentSource === 'current' && currentTier && (!peakTier || currentTier.id > peakTier.id)) {
    peakTier = currentTier
    peakAct = actLabel(acts.at(-1)?.season?.short)
  }

  return { currentTier, currentRr, currentSource, currentAct, peakTier, peakAct }
}
