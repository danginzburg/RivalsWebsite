import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { loadCurrentStandings } from '$lib/server/leaderboard/standings'
import { cardVersion, STATIC_PAGE_META, type PageMeta } from '$lib/meta'

export type { StandingsRow } from '$lib/server/leaderboard/standings'

type TeamRel = {
  id: string
  name: string
  tag?: string | null
  logo_path?: string | null
  approval_status?: string | null
  metadata?: Record<string, unknown> | null
}

/** The signed-in viewer's team, if they are on one. Never cached. */
async function loadMyTeam(authSub: string | undefined) {
  if (!authSub) return null

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('auth0_sub', authSub)
    .maybeSingle()

  if (!profile?.id) return null

  const { data: membership } = await supabaseAdmin
    .from('team_memberships')
    .select('team_id, role, teams (id, name, tag, logo_path, approval_status, metadata)')
    .eq('profile_id', profile.id)
    .eq('is_active', true)
    .is('left_at', null)
    .maybeSingle()

  const rel = (membership as { teams?: TeamRel | TeamRel[] | null } | null)?.teams
  const team = Array.isArray(rel) ? rel[0] : rel
  if (team?.approval_status !== 'approved') return null

  return {
    id: team.id,
    name: team.name,
    tag: team.tag ?? null,
    logo_url: getTeamLogoUrl(team),
    role: (membership as { role?: string | null } | null)?.role ?? null,
  }
}

export const load = async ({ locals }: { locals: App.Locals }) => {
  // Only the shared standings are cached — myTeam is per-viewer and must not
  // be served from a shared cache.
  const standings = await loadCurrentStandings()

  const myTeam = await loadMyTeam(locals.user?.sub)

  // The generated standings card (/og/leaderboard.png). The `v` changes with
  // the table, so Discord fetches a fresh image.
  const meta: PageMeta = {
    ...STATIC_PAGE_META['/leaderboard']!,
    image: `/og/leaderboard.png?v=${cardVersion([
      standings.season?.name ?? null,
      standings.rows.slice(0, 8).map((r) => [r.id, r.name, r.logo_url, r.stats]),
    ])}`,
    largeImage: true,
  }

  return {
    meta,
    rows: standings.rows,
    seeds: standings.seeds,
    batch: standings.batch,
    season: standings.season,
    zones: standings.zones,
    bracket: standings.bracket,
    myTeam,
    viewer: { isAdmin: locals.user?.role === 'admin' },
  }
}
