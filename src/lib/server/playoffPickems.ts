import { error } from '@sveltejs/kit'

import {
  PLAYOFF_MATCH_IDS,
  PLAYOFF_PICKEM_KIND,
  buildPlayoffBracketSlots,
  isPlayoffPickemLocked,
  normalizePlayoffPickemConfig,
  normalizePlayoffPickemPayload,
  playoffPickemConfigFromSeasonMetadata,
  rankPlayoffLeaderboardEntries,
  scorePlayoffPickemPayload,
  validatePlayoffPickemConfig,
  validatePlayoffPickemPayload,
  type PlayoffMatchId,
  type PlayoffPickemConfig,
  type PlayoffPickemPayload,
  type PlayoffPickemTeam,
} from '$lib/playoffPickems'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { supabaseAdmin } from '$lib/supabase/admin'

type TeamRow = {
  id: string
  name: string
  tag: string | null
  logo_path?: string | null
}

type LinkedMatchRow = {
  id: string
  status: string | null
  winner_team_id: string | null
}

export type PlayoffPickemContext = {
  season: {
    id: string
    code: string
    name: string
  }
  config: PlayoffPickemConfig
  teams: PlayoffPickemTeam[]
}

export type PlayoffPickemSubmissionRecord = {
  id: string
  season_id: string
  profile_id: string
  kind: typeof PLAYOFF_PICKEM_KIND
  payload: PlayoffPickemPayload
  score: number
  scored_at: string | null
  created_at: string
  updated_at: string
}

export type PlayoffPickemPublicSubmission = {
  id: string
  score: number
  scoredAt: string | null
  submittedAt: string
  payload: PlayoffPickemPayload
  user: {
    id: string | null
    name: string
  }
}

export type PlayoffPickemLeaderboardEntry = PlayoffPickemPublicSubmission & {
  rank: number
}

export type PlayoffPickemScoreSummary = {
  seasonId: string
  submissionsScored: number
  scoredAt: string
  completedMatches: number
}

function normalizeTeam(team: TeamRow): PlayoffPickemTeam {
  return {
    id: team.id,
    name: team.name,
    tag: team.tag ?? null,
    logo_url: getTeamLogoUrl(team),
  }
}

function profileName(profile: { display_name: string | null; email: string | null } | null) {
  return profile?.display_name?.trim() || profile?.email?.trim() || 'User'
}

export async function getPlayoffPickemContextBySeasonCode(
  seasonCode: string
): Promise<PlayoffPickemContext> {
  const { data: season, error: seasonError } = await supabaseAdmin
    .from('seasons')
    .select('id, code, name, metadata')
    .eq('code', seasonCode)
    .maybeSingle()

  if (seasonError || !season) throw error(404, 'Season not found')
  return getPlayoffPickemContextFromSeason(season)
}

export async function getPlayoffPickemContextBySeasonId(
  seasonId: string
): Promise<PlayoffPickemContext> {
  const { data: season, error: seasonError } = await supabaseAdmin
    .from('seasons')
    .select('id, code, name, metadata')
    .eq('id', seasonId)
    .maybeSingle()

  if (seasonError || !season) throw error(404, 'Season not found')
  return getPlayoffPickemContextFromSeason(season)
}

async function getPlayoffPickemContextFromSeason(season: {
  id: string
  code: string
  name: string
  metadata: unknown
}): Promise<PlayoffPickemContext> {
  const config = playoffPickemConfigFromSeasonMetadata(season.metadata)
  const teamIds = Array.from(new Set(config.seeds.map((seed) => seed.teamId)))
  let teams: PlayoffPickemTeam[] = []

  if (teamIds.length > 0) {
    const { data, error: teamsError } = await supabaseAdmin
      .from('teams')
      .select('id, name, tag, logo_path')
      .in('id', teamIds)

    if (teamsError) throw error(500, 'Failed to load playoff teams')
    const byId = new Map((data ?? []).map((team: TeamRow) => [team.id, normalizeTeam(team)]))
    teams = config.seeds
      .map((seed) => byId.get(seed.teamId))
      .filter((team): team is PlayoffPickemTeam => Boolean(team))
  }

  return {
    season: {
      id: season.id,
      code: season.code,
      name: season.name,
    },
    config,
    teams,
  }
}

export async function savePlayoffPickemConfigForSeason(
  seasonId: string,
  configInput: unknown
): Promise<PlayoffPickemConfig> {
  const { data: season, error: seasonError } = await supabaseAdmin
    .from('seasons')
    .select('metadata')
    .eq('id', seasonId)
    .maybeSingle()

  if (seasonError || !season) throw error(404, 'Season not found')

  const config = normalizePlayoffPickemConfig(configInput)
  if (config.enabled) {
    try {
      validatePlayoffPickemConfig(config)
    } catch (err) {
      throw error(400, err instanceof Error ? err.message : 'Invalid playoff pickem config')
    }
  }

  const metadata =
    season.metadata && typeof season.metadata === 'object'
      ? { ...(season.metadata as Record<string, unknown>) }
      : {}

  const { error: updateError } = await supabaseAdmin
    .from('seasons')
    .update({ metadata: { ...metadata, playoff_pickem: config } })
    .eq('id', seasonId)

  if (updateError) throw error(500, 'Failed to save playoff pickem config')
  return config
}

export async function getPlayoffPickemSubmissionForProfile(seasonId: string, profileId: string) {
  const { data, error: submissionError } = await supabaseAdmin
    .from('pickem_submissions')
    .select('id, season_id, profile_id, kind, payload, score, scored_at, created_at, updated_at')
    .eq('season_id', seasonId)
    .eq('profile_id', profileId)
    .eq('kind', PLAYOFF_PICKEM_KIND)
    .maybeSingle()

  if (submissionError) throw error(500, 'Failed to load playoff pickem submission')
  if (!data) return null
  return {
    ...data,
    kind: PLAYOFF_PICKEM_KIND,
    payload: normalizePlayoffPickemPayload(data.payload),
  } as PlayoffPickemSubmissionRecord
}

export async function upsertPlayoffPickemSubmission(input: {
  seasonId: string
  profileId: string
  payload: unknown
}) {
  const context = await getPlayoffPickemContextBySeasonId(input.seasonId)
  if (!context.config.enabled || context.config.status !== 'open') {
    throw error(400, "Playoff pick'em is not open")
  }
  if (isPlayoffPickemLocked(context.config)) {
    throw error(400, "Playoff pick'em is locked")
  }

  let payload: PlayoffPickemPayload
  try {
    payload = validatePlayoffPickemPayload(
      context.config,
      normalizePlayoffPickemPayload(input.payload)
    )
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Invalid playoff pickem submission')
  }

  const { data, error: upsertError } = await supabaseAdmin
    .from('pickem_submissions')
    .upsert(
      {
        season_id: input.seasonId,
        profile_id: input.profileId,
        kind: PLAYOFF_PICKEM_KIND,
        payload,
        score: 0,
        scored_at: null,
      },
      { onConflict: 'season_id,profile_id,kind' }
    )
    .select('id, season_id, profile_id, kind, payload, score, scored_at, created_at, updated_at')
    .single()

  if (upsertError) throw error(500, 'Failed to save playoff pickem submission')
  return {
    ...data,
    kind: PLAYOFF_PICKEM_KIND,
    payload: normalizePlayoffPickemPayload(data.payload),
  } as PlayoffPickemSubmissionRecord
}

export async function listPlayoffPickemPublicSubmissions(
  seasonId: string
): Promise<PlayoffPickemPublicSubmission[]> {
  const { data, error: listError } = await supabaseAdmin
    .from('pickem_submissions')
    .select(
      'id, created_at, score, scored_at, payload, profiles!pickem_submissions_profile_id_fkey (id, display_name, email)'
    )
    .eq('season_id', seasonId)
    .eq('kind', PLAYOFF_PICKEM_KIND)

  if (listError) throw error(500, 'Failed to load playoff pickem submissions')

  return (data ?? []).map(
    (row: {
      id: string
      created_at: string
      score: number
      scored_at: string | null
      payload: unknown
      profiles:
        | { id: string | null; display_name: string | null; email: string | null }
        | { id: string | null; display_name: string | null; email: string | null }[]
        | null
    }) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
      return {
        id: row.id,
        score: row.score,
        scoredAt: row.scored_at,
        submittedAt: row.created_at,
        payload: normalizePlayoffPickemPayload(row.payload),
        user: {
          id: profile?.id ?? null,
          name: profileName(profile ?? null),
        },
      }
    }
  )
}

export async function listPlayoffPickemLeaderboard(
  seasonId: string
): Promise<PlayoffPickemLeaderboardEntry[]> {
  return rankPlayoffLeaderboardEntries(await listPlayoffPickemPublicSubmissions(seasonId))
}

export async function getActualPlayoffWinnersFromLinkedMatches(config: PlayoffPickemConfig) {
  const linked = config.match_links.filter((link) => link.actualMatchId)
  const actualWinners: Partial<Record<PlayoffMatchId, string>> = {}
  if (linked.length === 0) return actualWinners

  const { data, error: matchesError } = await supabaseAdmin
    .from('matches')
    .select('id, status, winner_team_id')
    .in(
      'id',
      linked.map((link) => link.actualMatchId!)
    )

  if (matchesError) throw error(500, 'Failed to load linked playoff matches')
  const byId = new Map((data ?? []).map((match: LinkedMatchRow) => [match.id, match]))
  for (const link of linked) {
    const match = byId.get(link.actualMatchId!)
    if (match?.status === 'completed' && match.winner_team_id) {
      actualWinners[link.matchId] = match.winner_team_id
    }
  }
  return actualWinners
}

export async function scorePlayoffPickemSubmissionsForSeason(
  seasonId: string
): Promise<PlayoffPickemScoreSummary> {
  const context = await getPlayoffPickemContextBySeasonId(seasonId)
  if (!context.config.enabled) throw error(400, "Playoff pick'em is not enabled")
  if (!isPlayoffPickemLocked(context.config)) {
    throw error(400, "Playoff pick'em must be locked before scoring")
  }

  const actualWinners = await getActualPlayoffWinnersFromLinkedMatches(context.config)
  const scoredAt = new Date().toISOString()
  const { data: submissions, error: listError } = await supabaseAdmin
    .from('pickem_submissions')
    .select('id, payload')
    .eq('season_id', seasonId)
    .eq('kind', PLAYOFF_PICKEM_KIND)

  if (listError) throw error(500, 'Failed to load playoff pickem submissions')

  let submissionsScored = 0
  for (const submission of submissions ?? []) {
    const result = scorePlayoffPickemPayload(
      normalizePlayoffPickemPayload(submission.payload),
      actualWinners
    )
    const { error: updateError } = await supabaseAdmin
      .from('pickem_submissions')
      .update({ score: result.score, scored_at: scoredAt })
      .eq('id', submission.id)

    if (updateError) throw error(500, 'Failed to update playoff pickem score')
    submissionsScored += 1
  }

  return {
    seasonId,
    submissionsScored,
    scoredAt,
    completedMatches: PLAYOFF_MATCH_IDS.filter((matchId) => actualWinners[matchId]).length,
  }
}
