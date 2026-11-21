import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { loadSeasonFinalPlacements } from '$lib/server/seasons/finalPlacements'
import { seasonMvpName } from '$lib/seasons/mvp'
import { supabaseAdmin } from '$lib/supabase/admin'

/**
 * Backfill check for past seasons: what each one is still missing.
 *
 * `blocking` gaps keep teams out of career finishes (and so out of every
 * player's average placement); `minor` ones only leave a page thinner than it
 * could be. Seasons that have not ended yet are skipped — an open season is
 * expected to be incomplete.
 */
export type SeasonAuditIssue = { level: 'blocking' | 'minor'; message: string }
export type SeasonAudit = {
  id: string
  name: string
  code: string | null
  kind: string | null
  issues: SeasonAuditIssue[]
}

type SeasonRow = {
  id: string
  name: string
  code: string | null
  kind: string | null
  is_active: boolean | null
  ends_on: string | null
  starts_on: string | null
  metadata: Record<string, unknown> | null
  winner_team_id: string | null
  mvp_profile_id: string | null
  champion_clip_url: string | null
}

type TeamRow = { id: string; name: string; season_id: string; status: string | null }

const names = (list: string[], max = 6) =>
  list.length <= max ? list.join(', ') : `${list.slice(0, max).join(', ')} +${list.length - max}`

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)

  const { data: seasonRows, error: seasonsError } = await supabaseAdmin
    .from('seasons')
    .select(
      'id, name, code, kind, is_active, starts_on, ends_on, metadata, winner_team_id, mvp_profile_id, champion_clip_url'
    )
    .order('starts_on', { ascending: true, nullsFirst: false })
  if (seasonsError) throw error(500, 'Failed to load seasons')

  const today = new Date().toISOString().slice(0, 10)
  const past = ((seasonRows ?? []) as SeasonRow[]).filter(
    (s) => !s.is_active && (s.winner_team_id || (s.ends_on && s.ends_on < today))
  )
  const seasonIds = past.map((s) => s.id)
  if (seasonIds.length === 0) return json({ seasons: [] })

  const [teamsRes, matchesRes] = await Promise.all([
    supabaseAdmin
      .from('teams')
      .select('id, name, season_id, status')
      .in('season_id', seasonIds)
      .eq('approval_status', 'approved'),
    supabaseAdmin.from('matches').select('season_id').in('season_id', seasonIds),
  ])
  if (teamsRes.error || matchesRes.error) throw error(500, 'Failed to load season data')

  const teams = ((teamsRes.data ?? []) as TeamRow[]).filter((t) => t.status !== 'disbanded')
  const teamName = new Map(teams.map((t) => [t.id, t.name]))

  const rostered = new Set<string>()
  const teamIds = teams.map((t) => t.id)
  for (let i = 0; i < teamIds.length; i += 200) {
    const { data } = await supabaseAdmin
      .from('team_memberships')
      .select('team_id')
      .in('team_id', teamIds.slice(i, i + 200))
    for (const m of (data ?? []) as Array<{ team_id: string }>) rostered.add(m.team_id)
  }

  const matchCount = new Map<string, number>()
  for (const m of (matchesRes.data ?? []) as Array<{ season_id: string }>) {
    matchCount.set(m.season_id, (matchCount.get(m.season_id) ?? 0) + 1)
  }

  const audits: SeasonAudit[] = await Promise.all(
    past.map(async (season) => {
      const issues: SeasonAuditIssue[] = []
      const seasonTeams = teams.filter((t) => t.season_id === season.id)

      if (!season.winner_team_id) {
        issues.push({
          level: 'blocking',
          message: 'No champion recorded, so no team has a final placing yet.',
        })
      } else {
        const finals = await loadSeasonFinalPlacements(season.id)
        if (finals.unplaced.length > 0) {
          issues.push({
            level: 'blocking',
            message: `${finals.unplaced.length} of ${finals.teamCount} teams have no final placing (no bracket result or standings rank): ${names(finals.unplaced.map((id) => teamName.get(id) ?? id))}.`,
          })
        }
      }

      const empty = seasonTeams.filter((t) => !rostered.has(t.id)).map((t) => t.name)
      if (empty.length > 0) {
        issues.push({
          level: 'blocking',
          message: `${empty.length} team${empty.length === 1 ? ' has' : 's have'} no roster, so their players get no team history: ${names(empty)}.`,
        })
      }

      if (!matchCount.get(season.id)) {
        issues.push({ level: 'minor', message: 'No matches imported.' })
      }
      if (!season.mvp_profile_id) {
        const placeholder = seasonMvpName(season.metadata)
        issues.push({
          level: 'minor',
          message: placeholder
            ? `MVP is a placeholder name ("${placeholder}"), not linked to a profile.`
            : 'No MVP recorded.',
        })
      }
      if (!season.champion_clip_url) {
        issues.push({ level: 'minor', message: 'No champion clip.' })
      }
      const pool = season.metadata?.map_pool
      if (!Array.isArray(pool) || pool.length === 0) {
        issues.push({ level: 'minor', message: 'Map pool is empty.' })
      }

      return { id: season.id, name: season.name, code: season.code, kind: season.kind, issues }
    })
  )

  // Newest first, matching the seasons list below it.
  return json({ seasons: audits.reverse() })
}
