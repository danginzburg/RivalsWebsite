import { supabaseAdmin } from '$lib/supabase/admin'

function getTeamLogoUrl(team: any): string | null {
  if (!team?.logo_path) return null
  return supabaseAdmin.storage.from('team-logos').getPublicUrl(team.logo_path).data.publicUrl
}

export const load = async ({ locals }: { locals: App.Locals }) => {
  const { data: batch } = await supabaseAdmin
    .from('stat_import_batches')
    .select('id')
    .filter('metadata->>import_type', 'eq', 'leaderboard_entries')
    .eq('status', 'applied')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: teams } = await supabaseAdmin
    .from('teams')
    .select('id, name, tag, logo_path, metadata')
    .eq('approval_status', 'approved')
    .order('name', { ascending: true })

  const teamIds = (teams ?? []).map((team) => team.id)
  const { data: entries } =
    batch && teamIds.length > 0
      ? await supabaseAdmin
          .from('leaderboard_entries')
          .select('team_id, rank, points, wins, losses')
          .eq('import_batch_id', batch.id)
          .in('team_id', teamIds)
      : { data: [] }

  const entryByTeamId = new Map<string, any>()
  for (const entry of entries ?? []) entryByTeamId.set(entry.team_id, entry)

  const rows = (teams ?? []).map((team) => ({
    id: team.id,
    name: team.name,
    tag: team.tag ?? null,
    logo_url: getTeamLogoUrl(team),
    org: team.metadata?.org ?? null,
    about: team.metadata?.about ?? null,
    leaderboard: entryByTeamId.get(team.id) ?? null,
  }))

  rows.sort((a, b) => {
    const ar = Number(a.leaderboard?.rank ?? Number.MAX_SAFE_INTEGER)
    const br = Number(b.leaderboard?.rank ?? Number.MAX_SAFE_INTEGER)
    if (ar !== br) return ar - br
    return a.name.localeCompare(b.name)
  })

  let myTeam = null as any
  if (locals.user?.sub) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('auth0_sub', locals.user.sub)
      .maybeSingle()

    if (profile?.id) {
      const { data: membership } = await supabaseAdmin
        .from('team_memberships')
        .select('team_id, role, teams (id, name, tag, logo_path, approval_status, metadata)')
        .eq('profile_id', profile.id)
        .eq('is_active', true)
        .is('left_at', null)
        .maybeSingle()

      const teamRel = membership
        ? Array.isArray((membership as any).teams)
          ? (membership as any).teams[0]
          : (membership as any).teams
        : null

      if (teamRel?.approval_status === 'approved') {
        myTeam = {
          id: teamRel.id,
          name: teamRel.name,
          tag: teamRel.tag ?? null,
          logo_url: getTeamLogoUrl(teamRel),
          role: membership?.role ?? null,
        }
      }
    }
  }

  return { teams: rows, myTeam }
}
