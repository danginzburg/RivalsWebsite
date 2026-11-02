import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import {
  formatRecordValue,
  getRecordCategory,
  RECORD_CATEGORIES,
  recordTitle,
} from '$lib/records/categories'
import { CATEGORY_ENTRY_KEY, recordEntryKey, type StatRecordOverride } from './overrides'

type TeamRel = { id: string; name: string; tag?: string | null; logo_path?: string | null }
type ProfileRel = { id: string; display_name: string | null }
type SeasonRel = { id: string; code: string; name: string }

function firstRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function toTeam(value: unknown) {
  const team = firstRel(value as TeamRel | TeamRel[] | null)
  return team
    ? { id: team.id, name: team.name, tag: team.tag ?? null, logo_url: getTeamLogoUrl(team) }
    : null
}

const RECORD_SELECT = `
  id,
  category,
  rank,
  value,
  holder_kind,
  player_name,
  puuid,
  match_id,
  match_map_id,
  player_match_map_stat_id,
  map_name,
  agents,
  stage,
  achieved_at,
  superseded_at,
  tie_count,
  context,
  profile:profiles!stat_records_profile_id_fkey (id, display_name),
  team:teams!stat_records_team_id_fkey (id, name, tag, logo_path),
  opponent:teams!stat_records_opponent_team_id_fkey (id, name, tag, logo_path),
  season:seasons!stat_records_season_id_fkey (id, code, name)
`

const OVERRIDE_SELECT = `
  track,
  category,
  entry_key,
  is_hidden,
  title,
  description,
  value_text,
  unit,
  profile_id,
  player_name,
  team_id,
  label,
  profile:profiles!stat_record_overrides_profile_id_fkey (id, display_name),
  team:teams!stat_record_overrides_team_id_fkey (id, name, tag, logo_path)
`

type OverrideRow = StatRecordOverride & { profile?: unknown; team?: unknown }

function normalizeEntry(row: Record<string, unknown>) {
  const profile = firstRel(row.profile as ProfileRel | ProfileRel[] | null)
  const season = firstRel(row.season as SeasonRel | SeasonRel[] | null)
  const category = row.category as string
  const rawValue = Number(row.value)
  const playerName = (row.player_name as string | null) ?? null
  const matchMapId = (row.match_map_id as string | null) ?? null
  const statId = row.player_match_map_stat_id == null ? null : Number(row.player_match_map_stat_id)
  return {
    id: row.id as string,
    category,
    rank: row.rank == null ? null : Number(row.rank),
    puuid: (row.puuid as string | null) ?? null,
    entryKey: recordEntryKey(matchMapId, statId),
    rawValue,
    value: formatRecordValue(category, rawValue),
    unit: getRecordCategory(category)?.unit ?? '',
    holderKind: row.holder_kind as 'player' | 'team',
    holder: profile
      ? { id: profile.id as string | null, name: profile.display_name ?? playerName ?? 'Player' }
      : playerName
        ? { id: null as string | null, name: playerName }
        : null,
    team: toTeam(row.team),
    opponent: toTeam(row.opponent),
    season: season ? { code: season.code, name: season.name } : null,
    matchId: row.match_id as string,
    mapName: (row.map_name as string | null) ?? null,
    agents: (row.agents as string | null) ?? null,
    achievedAt: (row.achieved_at as string | null) ?? null,
    tieCount: Number(row.tie_count ?? 0),
    context: (row.context ?? {}) as Record<string, unknown>,
  }
}

type Entry = ReturnType<typeof normalizeEntry>

function stripJoins(o: OverrideRow): StatRecordOverride {
  const rest: Record<string, unknown> = { ...o }
  delete rest.profile
  delete rest.team
  return rest as StatRecordOverride
}

/** Lay a performance edit over an entry; empty fields keep what the stats say. */
function applyEntryOverride(entry: Entry, o: OverrideRow | undefined) {
  const stats = {
    value: entry.value,
    unit: entry.unit,
    holder: entry.holder?.name ?? null,
    team: entry.team?.name ?? null,
  }
  if (!o) return { ...entry, stats, override: null as StatRecordOverride | null }

  const profile = firstRel(o.profile as ProfileRel | ProfileRel[] | null)
  return {
    ...entry,
    value: o.value_text || entry.value,
    unit: o.unit || entry.unit,
    holder: profile
      ? { id: profile.id as string | null, name: profile.display_name ?? 'Player' }
      : o.player_name
        ? { id: null as string | null, name: o.player_name }
        : entry.holder,
    team: toTeam(o.team) ?? entry.team,
    stats,
    override: stripJoins(o) as StatRecordOverride | null,
  }
}

/** Who is looking: their profile and every approved Riot account linked to it. */
export async function loadRecordViewer(authSub: string | null | undefined) {
  if (!authSub) return null
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('auth0_sub', authSub)
    .maybeSingle()
  if (!profile) return null

  const { data: accounts } = await supabaseAdmin
    .from('riot_accounts')
    .select('puuid')
    .eq('profile_id', profile.id)
    .eq('status', 'approved')
  return {
    profileId: profile.id as string,
    puuids: new Set((accounts ?? []).map((a) => a.puuid as string | null).filter(Boolean)),
  }
}

type RecordViewer = Awaited<ReturnType<typeof loadRecordViewer>>

/**
 * Whether the viewer is among the performances level with the last one listed
 * but cut off the card — matched by profile, or by any Riot account of theirs
 * in case the stat row was never linked to the profile. A viewer already on
 * the list is not told they are tied as well; they can see themselves there.
 */
export function viewerIsTiedOff(
  listed: Array<{ holder: { id: string | null } | null; puuid: string | null }>,
  context: Record<string, unknown>,
  viewer: RecordViewer
): boolean {
  if (!viewer) return false
  const onList = listed.some(
    (e) => e.holder?.id === viewer.profileId || (e.puuid !== null && viewer.puuids.has(e.puuid))
  )
  if (onList) return false
  const profileIds = (context.tied_off_profile_ids as string[] | undefined) ?? []
  const puuids = (context.tied_off_puuids as string[] | undefined) ?? []
  return profileIds.includes(viewer.profileId) || puuids.some((p) => viewer.puuids.has(p))
}

/** The tie lists are for the check above only; they never go to the browser. */
export function withoutTieLists(context: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...context }
  delete rest.tied_off_profile_ids
  delete rest.tied_off_puuids
  return rest
}

/**
 * A duel names the player who was beaten. The rebuild snapshots their Riot
 * ID; a linked player shows by their site name instead, like the holder does.
 */
async function nameDuelOpponents(entries: Entry[]) {
  const ids = [
    ...new Set(
      entries
        .map((e) => e.context.duel_opponent_profile_id)
        .filter((id): id is string => typeof id === 'string')
    ),
  ]
  if (ids.length === 0) return

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name')
    .in('id', ids)
  if (error) {
    console.error('Failed to name duel opponents:', error)
    return
  }

  const names = new Map((data ?? []).map((p) => [p.id as string, p.display_name as string | null]))
  for (const entry of entries) {
    const name = names.get(entry.context.duel_opponent_profile_id as string)
    if (name) entry.context.duel_opponent_name = name
  }
}

/**
 * A track's categories in display order, each with its current top 5 (admin
 * edits applied) and the edits that no longer match a performance in the
 * top 5 — hidden performances among them.
 */
export async function loadTrackRecords(track: string, options: { includeHidden?: boolean } = {}) {
  const [{ data: recordRows, error: recordsError }, { data: overrideRows, error: overridesError }] =
    await Promise.all([
      supabaseAdmin
        .from('stat_records')
        .select(RECORD_SELECT)
        .eq('track', track)
        .order('achieved_at', { ascending: false }),
      supabaseAdmin.from('stat_record_overrides').select(OVERRIDE_SELECT).eq('track', track),
    ])

  if (recordsError) console.error('Failed to load stat records:', recordsError)
  // The overrides migration may not be applied yet; records still show unedited.
  if (overridesError) console.error('Failed to load stat record overrides:', overridesError)

  const entries = ((recordRows ?? []) as Record<string, unknown>[]).map(normalizeEntry)
  const overrides = (overrideRows ?? []) as unknown as OverrideRow[]
  await nameDuelOpponents(entries)

  return RECORD_CATEGORIES.flatMap((category) => {
    const ranked = entries
      .filter((e) => e.category === category.key && e.rank !== null)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    if (ranked.length === 0) return []

    const edits = overrides.filter((o) => o.category === category.key)
    const categoryEdit = edits.find((o) => o.entry_key === CATEGORY_ENTRY_KEY)
    const entryEdits = new Map(
      edits.filter((o) => o.entry_key !== CATEGORY_ENTRY_KEY).map((o) => [o.entry_key, o])
    )
    const isHidden = categoryEdit?.is_hidden ?? false
    if (isHidden && !options.includeHidden) return []

    const top = ranked.map((e) => applyEntryOverride(e, entryEdits.get(e.entryKey)))
    const shownKeys = new Set(top.map((e) => e.entryKey))

    return [
      {
        category: category.key,
        title: categoryEdit?.title || recordTitle(category.key),
        defaultTitle: recordTitle(category.key),
        description: categoryEdit?.description || null,
        isHidden,
        categoryOverride: categoryEdit ? stripJoins(categoryEdit) : null,
        holderKind: category.holder,
        /** More performances level with the last one listed, cut off the list. */
        hiddenTies: ranked.at(-1)?.tieCount ?? 0,
        top,
        /** Hidden performances, and corrections whose performance left the top 5 or was re-imported. */
        detachedEdits: [...entryEdits.values()]
          .filter((o) => !shownKeys.has(o.entry_key))
          .map(stripJoins),
      },
    ]
  })
}

export type TrackRecord = Awaited<ReturnType<typeof loadTrackRecords>>[number]
