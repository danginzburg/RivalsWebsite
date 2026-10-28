/**
 * The pure half of the season accolade sync: given the awards a season's
 * results call for and the assignments already on record, work out what to
 * add and what to take back. Kept apart from the database code so the rules
 * can be tested on their own.
 */

export type SeasonAward = {
  accoladeId: string
  profileId: string
  seasonId: string
  /** The label players see next to the accolade, e.g. "Season 3". */
  context: string
}

export type ExistingAssignment = {
  id: string
  accolade_id: string
  profile_id: string
  season_id: string | null
  context: string | null
  source: 'manual' | 'auto'
}

export type AwardDismissal = { accolade_id: string; profile_id: string; season_id: string }

export type SeasonLabel = { id: string; name: string | null; code: string | null }

export type AccoladeSyncPlan = {
  insert: SeasonAward[]
  /** Automatic assignments the season's results no longer back. */
  remove: ExistingAssignment[]
}

/** Case- and spacing-insensitive form of a season label ("Season  2" = "season 2"). */
export function normalizeSeasonLabel(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** The context an automatic award carries: the season's name, tidied. */
export function seasonContextLabel(season: SeasonLabel): string {
  return String(season.name ?? season.code ?? 'Season')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Which season an assignment belongs to: its `season_id`, or, for one an admin
 * typed in by hand, the season its context names.
 */
function assignmentSeasonId(row: ExistingAssignment, seasons: SeasonLabel[]): string | null {
  if (row.season_id) return row.season_id
  const label = normalizeSeasonLabel(row.context)
  if (!label) return null
  const match = seasons.find(
    (s) => normalizeSeasonLabel(s.name) === label || normalizeSeasonLabel(s.code) === label
  )
  return match?.id ?? null
}

const awardKey = (accoladeId: string, profileId: string, seasonId: string) =>
  `${accoladeId}|${profileId}|${seasonId}`

/**
 * Plan a sync over `scope`: the seasons (and, optionally, the one player) whose
 * awards were recomputed. Any assignment of the same accolade to the same player
 * for the same season counts as already given, however it was made. Only
 * automatic rows are ever taken back, and an award an admin dismissed is never
 * re-added.
 */
export function planAccoladeSync(input: {
  desired: SeasonAward[]
  existing: ExistingAssignment[]
  dismissed: AwardDismissal[]
  seasons: SeasonLabel[]
  scope: { seasonIds: string[]; profileId?: string | null }
}): AccoladeSyncPlan {
  const scopeSeasons = new Set(input.scope.seasonIds)
  const inScope = (seasonId: string | null, profileId: string) =>
    seasonId !== null &&
    scopeSeasons.has(seasonId) &&
    (!input.scope.profileId || input.scope.profileId === profileId)

  const desired = new Map<string, SeasonAward>()
  for (const award of input.desired) {
    if (!inScope(award.seasonId, award.profileId)) continue
    desired.set(awardKey(award.accoladeId, award.profileId, award.seasonId), award)
  }

  const given = new Set<string>()
  const remove: ExistingAssignment[] = []
  for (const row of input.existing) {
    const seasonId = assignmentSeasonId(row, input.seasons)
    if (!seasonId) continue
    const key = awardKey(row.accolade_id, row.profile_id, seasonId)
    if (row.source === 'auto' && inScope(seasonId, row.profile_id) && !desired.has(key)) {
      remove.push(row)
      continue
    }
    given.add(key)
  }

  const dismissed = new Set(
    input.dismissed.map((d) => awardKey(d.accolade_id, d.profile_id, d.season_id))
  )

  const insert = [...desired.entries()]
    .filter(([key]) => !given.has(key) && !dismissed.has(key))
    .map(([, award]) => award)

  return { insert, remove }
}
