import { redirect } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { listUnlinkedIdentities } from '$lib/server/players/riot-identities'
import { listNameOnlyRosterSlots } from '$lib/server/teams/roster-slots'

export const load = async ({ locals }: { locals: App.Locals }) => {
  if (!locals.user) {
    throw redirect(303, '/auth/login?returnTo=/admin/riot-identities')
  }

  await requireAdmin(locals.user)

  // Both lists are scoped to the active season: older events are settled, and
  // listing every identity and slot from all of them buries the ones that matter.
  const { data: activeSeason } = await supabaseAdmin
    .from('seasons')
    .select('id, name')
    .eq('is_active', true)
    .maybeSingle()
  const activeSeasonId = (activeSeason?.id as string | undefined) ?? null

  const [identities, rosterSlots, { data: profiles }, { data: accounts }] = await Promise.all([
    listUnlinkedIdentities(200, { seasonId: activeSeasonId }),
    listNameOnlyRosterSlots(activeSeasonId),
    supabaseAdmin
      .from('profiles')
      .select('id, display_name')
      .order('display_name', { ascending: true, nullsFirst: false }),
    // Each player's existing Riot accounts, so the link confirmation can warn
    // before a second identity is attached to the same player by mistake.
    supabaseAdmin
      .from('riot_accounts')
      .select('profile_id, riot_name, riot_tag')
      .not('profile_id', 'is', null),
  ])

  // Queue entries already holding a roster slot this season. They stay in the
  // queue (the account still belongs to no player profile) but are labelled so
  // they read as handled for roster purposes.
  const queuePuuids = identities.map((i) => i.puuid)
  const rosteredOn = new Map<string, string[]>()
  for (let i = 0; i < queuePuuids.length && activeSeasonId; i += 100) {
    const { data: slots } = await supabaseAdmin
      .from('team_memberships')
      .select('puuid, teams (name)')
      .eq('season_id', activeSeasonId)
      .in('puuid', queuePuuids.slice(i, i + 100))
      .or('is_active.eq.true,left_at.not.is.null')
    for (const slot of slots ?? []) {
      const team = Array.isArray(slot.teams) ? slot.teams[0] : slot.teams
      const name = (team as { name?: string } | null)?.name
      if (!slot.puuid || !name) continue
      const list = rosteredOn.get(slot.puuid) ?? []
      if (!list.includes(name)) list.push(name)
      rosteredOn.set(slot.puuid, list)
    }
  }

  const accountsByProfile = new Map<string, string[]>()
  for (const account of accounts ?? []) {
    const name = String(account.riot_name ?? '').trim()
    if (!name) continue
    const list = accountsByProfile.get(account.profile_id) ?? []
    list.push(account.riot_tag ? `${name}#${account.riot_tag}` : name)
    accountsByProfile.set(account.profile_id, list)
  }

  return {
    activeSeasonName: (activeSeason?.name as string | undefined) ?? null,
    identities: identities.map((i) => ({ ...i, rostered_on: rosteredOn.get(i.puuid) ?? [] })),
    rosterSlots,
    profiles: (profiles ?? []).map((p) => ({
      id: p.id,
      label: p.display_name ?? 'Unnamed player',
      riotAccounts: accountsByProfile.get(p.id) ?? [],
    })),
  }
}
