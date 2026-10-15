import { supabaseAdmin } from '$lib/supabase/admin'
import { normalizeBaseName } from '$lib/server/imports/matching'
import { isShortStint } from '$lib/server/matches/subs'

/**
 * Roster slots that carry neither a PUUID nor a profile — matched to stats by
 * the typed handle alone, which rarely equals the Riot ID in the stats. Those
 * players read as subs in their own team's matches until the slot is pointed at
 * the right Riot account.
 */

/** A Riot account seen playing for the slot's team: the likely owner of the slot. */
export type SlotCandidate = {
  puuid: string
  riot_id: string
  maps: number
  /**
   * Another team on which this account (by PUUID, its profile, or its Riot ID)
   * already holds an open roster spot this season. A player can hold only one
   * open spot per season, so it cannot also take an open slot here.
   */
  open_spot_on: string | null
}

export type NameOnlySlot = {
  id: number
  player_name: string
  team: { id: string; name: string; tag: string | null; disbanded: boolean }
  season: { id: string | null; name: string; starts_on: string }
  is_open: boolean
  left_at: string | null
  candidates: SlotCandidate[]
  /** The candidate whose name resembles the slot's handle, when one does. */
  suggested_puuid: string | null
  /**
   * A linked slot (PUUID or profile) on the same team whose name resembles this
   * one: the sign of a mis-entered duplicate that can simply be removed.
   */
  duplicate_of: string | null
}

type TeamRel = {
  id: string
  name: string
  tag: string | null
  approval_status: string | null
  season_id: string | null
  seasons?:
    | { id: string; name: string | null; starts_on: string | null }
    | Array<{ id: string; name: string | null; starts_on: string | null }>
    | null
}

type SlotRow = {
  id: number
  team_id: string
  player_name: string | null
  joined_at: string | null
  left_at: string | null
  is_active: boolean | null
  teams?: TeamRel | TeamRel[] | null
}

/** Loose name resemblance: one handle contains the other once tags are stripped. */
function resembles(slotName: string, riotId: string): boolean {
  const a = normalizeBaseName(slotName)
  const b = normalizeBaseName(riotId)
  if (!a || !b) return false
  return a === b || (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a)))
}

/**
 * Fill each candidate's `open_spot_on`: the other team in the season where the
 * same player already holds an open roster spot, matched by PUUID, by the
 * profile that owns the PUUID, or by the Riot ID typed as a slot name. These
 * are the clashes the one-open-spot-per-season indexes would reject.
 */
async function markOpenSpotsElsewhere(
  seasonId: string,
  candidatesByTeam: Map<string, Map<string, SlotCandidate>>
): Promise<void> {
  const puuids = Array.from(
    new Set(Array.from(candidatesByTeam.values()).flatMap((byPuuid) => [...byPuuid.keys()]))
  )
  if (puuids.length === 0) return

  const profileByPuuid = new Map<string, string>()
  for (let i = 0; i < puuids.length; i += 100) {
    const chunk = puuids.slice(i, i + 100)
    const [{ data: accounts }, { data: identities }] = await Promise.all([
      supabaseAdmin
        .from('profile_riot_accounts')
        .select('profile_id, riot_puuid')
        .in('riot_puuid', chunk),
      supabaseAdmin
        .from('riot_identities')
        .select('puuid, profile_id')
        .in('puuid', chunk)
        .not('profile_id', 'is', null),
    ])
    for (const row of identities ?? []) {
      if (row.profile_id) profileByPuuid.set(row.puuid, row.profile_id)
    }
    for (const row of accounts ?? []) {
      if (row.riot_puuid && row.profile_id) profileByPuuid.set(row.riot_puuid, row.profile_id)
    }
  }

  type OpenRow = {
    team_id: string
    puuid: string | null
    profile_id: string | null
    player_name: string | null
    teams?: { name?: string } | Array<{ name?: string }> | null
  }
  const { data: openRows } = await supabaseAdmin
    .from('team_memberships')
    .select('team_id, puuid, profile_id, player_name, teams (name)')
    .eq('season_id', seasonId)
    .eq('is_active', true)
    .is('left_at', null)

  const spotsByPuuid = new Map<string, Array<{ teamId: string; name: string }>>()
  const spotsByProfile = new Map<string, Array<{ teamId: string; name: string }>>()
  const spotsByName = new Map<string, Array<{ teamId: string; name: string }>>()
  const add = (map: typeof spotsByPuuid, key: string, spot: { teamId: string; name: string }) => {
    const list = map.get(key) ?? []
    list.push(spot)
    map.set(key, list)
  }
  for (const row of (openRows ?? []) as OpenRow[]) {
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
    const spot = { teamId: row.team_id, name: team?.name ?? 'another team' }
    if (row.puuid) add(spotsByPuuid, row.puuid, spot)
    if (row.profile_id) add(spotsByProfile, row.profile_id, spot)
    if (row.player_name) add(spotsByName, row.player_name.trim().toLowerCase(), spot)
  }

  for (const [teamId, byPuuid] of candidatesByTeam) {
    for (const candidate of byPuuid.values()) {
      const profileId = profileByPuuid.get(candidate.puuid)
      const spots = [
        ...(spotsByPuuid.get(candidate.puuid) ?? []),
        ...(profileId ? (spotsByProfile.get(profileId) ?? []) : []),
        ...(spotsByName.get(candidate.riot_id.trim().toLowerCase()) ?? []),
      ]
      candidate.open_spot_on = spots.find((spot) => spot.teamId !== teamId)?.name ?? null
    }
  }
}

/** Name-only slots on rosters filed under `seasonId`. */
export async function listNameOnlyRosterSlots(seasonId: string | null): Promise<NameOnlySlot[]> {
  if (!seasonId) return []
  // `seasons` has three FKs back to `teams`, so the embed names the one it means.
  const { data, error } = await supabaseAdmin
    .from('team_memberships')
    .select(
      `
      id, team_id, player_name, joined_at, left_at, is_active,
      teams (
        id, name, tag, approval_status, season_id,
        seasons!teams_season_id_fkey (id, name, starts_on)
      )
    `
    )
    .eq('season_id', seasonId)
    .is('puuid', null)
    .is('profile_id', null)
    .or('is_active.eq.true,left_at.not.is.null')

  if (error) throw new Error('Failed to load roster slots')

  const slots = ((data ?? []) as SlotRow[]).filter(
    (row) => row.player_name && !isShortStint(row.joined_at, row.left_at)
  )
  if (slots.length === 0) return []

  const teamIds = Array.from(new Set(slots.map((row) => row.team_id)))

  // Everyone who has played for these teams, and every identity already on
  // their rosters (so a candidate already holding a slot is not offered twice).
  const [{ data: statRows }, { data: rostered }] = await Promise.all([
    supabaseAdmin
      .from('player_match_map_stats')
      .select('team_id, puuid, player_name')
      .in('team_id', teamIds)
      .not('puuid', 'is', null),
    supabaseAdmin
      .from('team_memberships')
      .select('team_id, puuid, profile_id, player_name')
      .in('team_id', teamIds)
      .or('is_active.eq.true,left_at.not.is.null'),
  ])

  const rosteredProfiles = Array.from(
    new Set((rostered ?? []).map((r) => r.profile_id).filter((id): id is string => Boolean(id)))
  )
  const { data: rosteredAccounts } = rosteredProfiles.length
    ? await supabaseAdmin
        .from('profile_riot_accounts')
        .select('profile_id, riot_puuid')
        .in('profile_id', rosteredProfiles)
        .not('riot_puuid', 'is', null)
    : { data: [] as Array<{ profile_id: string; riot_puuid: string | null }> }

  const puuidsByProfile = new Map<string, string[]>()
  for (const account of rosteredAccounts ?? []) {
    const list = puuidsByProfile.get(account.profile_id) ?? []
    if (account.riot_puuid) list.push(account.riot_puuid)
    puuidsByProfile.set(account.profile_id, list)
  }
  const linkedNamesByTeam = new Map<string, string[]>()
  const takenByTeam = new Map<string, Set<string>>()
  for (const row of rostered ?? []) {
    const taken = takenByTeam.get(row.team_id) ?? new Set<string>()
    if (row.puuid) taken.add(row.puuid)
    for (const puuid of puuidsByProfile.get(row.profile_id ?? '') ?? []) taken.add(puuid)
    takenByTeam.set(row.team_id, taken)
    if ((row.puuid || row.profile_id) && row.player_name) {
      const names = linkedNamesByTeam.get(row.team_id) ?? []
      names.push(row.player_name)
      linkedNamesByTeam.set(row.team_id, names)
    }
  }

  const candidatesByTeam = new Map<string, Map<string, SlotCandidate>>()
  for (const row of statRows ?? []) {
    const puuid = String(row.puuid ?? '')
    if (!puuid || takenByTeam.get(row.team_id)?.has(puuid)) continue
    const byPuuid = candidatesByTeam.get(row.team_id) ?? new Map<string, SlotCandidate>()
    const current = byPuuid.get(puuid)
    if (current) current.maps += 1
    else {
      byPuuid.set(puuid, {
        puuid,
        riot_id: String(row.player_name ?? puuid),
        maps: 1,
        open_spot_on: null,
      })
    }
    candidatesByTeam.set(row.team_id, byPuuid)
  }

  await markOpenSpotsElsewhere(seasonId, candidatesByTeam)

  return slots
    .map((row): NameOnlySlot | null => {
      const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
      if (!team) return null
      const season = Array.isArray(team.seasons) ? team.seasons[0] : team.seasons
      const candidates = Array.from(candidatesByTeam.get(row.team_id)?.values() ?? []).sort(
        (a, b) => b.maps - a.maps
      )
      const playerName = row.player_name ?? ''
      return {
        id: row.id,
        player_name: playerName,
        team: {
          id: team.id,
          name: team.name,
          tag: team.tag ?? null,
          disbanded: team.approval_status !== 'approved',
        },
        season: {
          id: season?.id ?? null,
          name: season?.name ?? 'Unassigned season',
          starts_on: season?.starts_on ?? '',
        },
        is_open: Boolean(row.is_active) && !row.left_at,
        left_at: row.left_at ?? null,
        candidates,
        suggested_puuid:
          candidates.find(
            (c) =>
              resembles(playerName, c.riot_id) &&
              !(c.open_spot_on && Boolean(row.is_active) && !row.left_at)
          )?.puuid ?? null,
        duplicate_of:
          (linkedNamesByTeam.get(row.team_id) ?? []).find((name) => resembles(playerName, name)) ??
          null,
      }
    })
    .filter((slot): slot is NameOnlySlot => slot !== null)
    .sort(
      (a, b) =>
        b.season.starts_on.localeCompare(a.season.starts_on) ||
        a.team.name.localeCompare(b.team.name) ||
        a.player_name.localeCompare(b.player_name)
    )
}
