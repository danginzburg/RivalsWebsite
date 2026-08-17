import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'

type TeamRel = { id: string; name: string; tag?: string | null; logo_path?: string | null }
type ProfileRel = { id: string; display_name: string | null; riot_id_base: string | null }
type SeasonRel = { id: string; code: string; name: string }

function firstRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export const load = async ({ locals }: { locals: App.Locals }) => {
  const isAdmin = locals.user?.role === 'admin'

  const [{ data: entries, error: entriesError }, { data: champions }] = await Promise.all([
    supabaseAdmin
      .from('hall_of_fame_entries')
      .select(
        `
        id,
        entry_type,
        title,
        description,
        stat_value,
        stat_label,
        media_url,
        player_name,
        created_at,
        profile:profiles!hall_of_fame_entries_profile_id_fkey (id, display_name, riot_id_base),
        team:teams!hall_of_fame_entries_team_id_fkey (id, name, tag, logo_path),
        season:seasons!hall_of_fame_entries_season_id_fkey (id, code, name)
      `
      )
      .eq('is_published', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false }),

    // Season champions come straight from the seasons table so they stay in sync
    // with what the Events pages show — no duplicate data entry required.
    supabaseAdmin
      .from('seasons')
      .select(
        `
        id,
        code,
        name,
        ends_on,
        winner:teams!seasons_winner_team_id_fkey (id, name, tag, logo_path),
        mvp:profiles!seasons_mvp_profile_id_fkey (id, display_name, riot_id_base)
      `
      )
      .not('winner_team_id', 'is', null)
      .order('starts_on', { ascending: false, nullsFirst: false }),
  ])

  if (entriesError) {
    // The table may not exist yet if the migration has not been applied.
    console.error('Failed to load hall of fame entries:', entriesError)
  }

  const normalized = (entries ?? []).map((entry) => {
    const profile = firstRel(entry.profile as unknown as ProfileRel | ProfileRel[] | null)
    const team = firstRel(entry.team as unknown as TeamRel | TeamRel[] | null)
    const season = firstRel(entry.season as unknown as SeasonRel | SeasonRel[] | null)

    return {
      id: entry.id,
      entry_type: entry.entry_type as 'record' | 'moment' | 'award',
      title: entry.title,
      description: entry.description ?? null,
      stat_value: entry.stat_value ?? null,
      stat_label: entry.stat_label ?? null,
      media_url: entry.media_url ?? null,
      holder: profile
        ? { id: profile.id, name: profile.display_name ?? profile.riot_id_base ?? 'Player' }
        : entry.player_name
          ? { id: null, name: entry.player_name }
          : null,
      team: team
        ? { id: team.id, name: team.name, tag: team.tag ?? null, logo_url: getTeamLogoUrl(team) }
        : null,
      season: season ? { code: season.code, name: season.name } : null,
    }
  })

  const seasonChampions = (champions ?? []).map((season) => {
    const winner = firstRel(season.winner as unknown as TeamRel | TeamRel[] | null)
    const mvp = firstRel(season.mvp as unknown as ProfileRel | ProfileRel[] | null)
    return {
      code: season.code,
      name: season.name,
      ends_on: season.ends_on,
      winner: winner
        ? {
            id: winner.id,
            name: winner.name,
            tag: winner.tag ?? null,
            logo_url: getTeamLogoUrl(winner),
          }
        : null,
      mvp: mvp ? { id: mvp.id, name: mvp.display_name ?? mvp.riot_id_base ?? 'Player' } : null,
    }
  })

  return {
    records: normalized.filter((e) => e.entry_type === 'record'),
    moments: normalized.filter((e) => e.entry_type === 'moment'),
    awards: normalized.filter((e) => e.entry_type === 'award'),
    seasonChampions,
    viewer: { isAdmin },
  }
}
