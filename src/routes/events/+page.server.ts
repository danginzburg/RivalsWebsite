import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { getSeasonLogoUrl } from '$lib/server/seasons/logo'
import { normalizePickemSeeds } from '$lib/pickems'

type TeamRel = { id: string; name: string; tag?: string | null; logo_path?: string | null }
type ProfileRel = { id: string; display_name: string | null; riot_id_base: string | null }

function firstRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export const load = async ({ locals }: { locals: App.Locals }) => {
  const isAdmin = locals.user?.role === 'admin'

  const { data: seasons, error: seasonsError } = await supabaseAdmin
    .from('seasons')
    .select(
      `
      id,
      code,
      name,
      starts_on,
      ends_on,
      is_active,
      summary,
      metadata,
      logo_path,
      winner_team_id,
      runner_up_team_id,
      mvp_profile_id,
      created_at,
      winner:teams!seasons_winner_team_id_fkey (id, name, tag, logo_path),
      runner_up:teams!seasons_runner_up_team_id_fkey (id, name, tag, logo_path),
      mvp:profiles!seasons_mvp_profile_id_fkey (id, display_name, riot_id_base)
    `
    )
    .order('is_active', { ascending: false })
    .order('starts_on', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (seasonsError) {
    console.error('Failed to load seasons:', seasonsError)
    return { seasons: [], viewer: { isAdmin } }
  }

  const seasonIds = (seasons ?? []).map((s) => s.id)

  // Per-season counts so each card can show scale without a detail fetch.
  const [{ data: matchRows }, { data: teamRows }] = await Promise.all([
    seasonIds.length > 0
      ? supabaseAdmin
          .from('matches')
          .select('id, season_id, status')
          .in('season_id', seasonIds)
          .eq('approval_status', 'approved')
      : Promise.resolve({ data: [] as Array<{ season_id: string; status: string }> }),
    seasonIds.length > 0
      ? supabaseAdmin
          .from('teams')
          .select('id, season_id')
          .in('season_id', seasonIds)
          .eq('approval_status', 'approved')
      : Promise.resolve({ data: [] as Array<{ season_id: string }> }),
  ])

  const matchCounts = new Map<string, { total: number; completed: number }>()
  for (const row of matchRows ?? []) {
    const key = String((row as { season_id: string }).season_id)
    const current = matchCounts.get(key) ?? { total: 0, completed: 0 }
    current.total += 1
    if ((row as { status: string }).status === 'completed') current.completed += 1
    matchCounts.set(key, current)
  }

  const teamCounts = new Map<string, number>()
  for (const row of teamRows ?? []) {
    const key = String((row as { season_id: string }).season_id)
    teamCounts.set(key, (teamCounts.get(key) ?? 0) + 1)
  }

  // Bracket presence + playoff team count come from each season's pick'em event.
  const { data: pickemRows } =
    seasonIds.length > 0
      ? await supabaseAdmin
          .from('pickem_events')
          .select('season_id, format, config')
          .in('season_id', seasonIds)
      : { data: [] as Array<{ season_id: string; format: string; config: unknown }> }

  const pickemBySeason = new Map<string, { format: string; seedCount: number }>()
  for (const row of pickemRows ?? []) {
    const config =
      row.config && typeof row.config === 'object' ? (row.config as Record<string, unknown>) : {}
    const seedCount = normalizePickemSeeds(config.seeds).filter((s) => s.teamId).length
    pickemBySeason.set(String(row.season_id), { format: row.format, seedCount })
  }

  const normalized = (seasons ?? []).map((season) => {
    const winner = firstRel(season.winner as TeamRel | TeamRel[] | null)
    const runnerUp = firstRel(season.runner_up as TeamRel | TeamRel[] | null)
    const mvp = firstRel(season.mvp as unknown as ProfileRel | ProfileRel[] | null)
    const pickem = pickemBySeason.get(season.id) ?? null
    const counts = matchCounts.get(season.id) ?? { total: 0, completed: 0 }

    return {
      id: season.id,
      code: season.code,
      name: season.name,
      starts_on: season.starts_on,
      ends_on: season.ends_on,
      is_active: season.is_active,
      summary: season.summary ?? null,
      logo_url: getSeasonLogoUrl(season),
      winner: winner
        ? {
            id: winner.id,
            name: winner.name,
            tag: winner.tag ?? null,
            logo_url: getTeamLogoUrl(winner),
          }
        : null,
      runner_up: runnerUp
        ? {
            id: runnerUp.id,
            name: runnerUp.name,
            tag: runnerUp.tag ?? null,
            logo_url: getTeamLogoUrl(runnerUp),
          }
        : null,
      mvp: mvp ? { id: mvp.id, name: mvp.display_name ?? mvp.riot_id_base ?? 'Player' } : null,
      match_count: counts.total,
      completed_count: counts.completed,
      team_count: teamCounts.get(season.id) ?? 0,
      has_bracket: pickem?.format === 'bracket' && pickem.seedCount > 0,
      // Seeds actually assigned a team — how many made playoffs.
      playoff_team_count: pickem?.seedCount ?? 0,
    }
  })

  return { seasons: normalized, viewer: { isAdmin } }
}
