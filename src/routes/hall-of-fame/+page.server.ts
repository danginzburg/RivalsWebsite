import { requireNavPage } from '$lib/server/nav-visibility'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getTeamLogoUrl } from '$lib/server/teams/logo'
import { loadRecordTracks, RIVALS_TRACK } from '$lib/server/records/tracks'
import {
  loadRecordViewer,
  loadTrackRecords,
  viewerIsTiedOff,
  withoutTieLists,
} from '$lib/server/records/read'
import { resolveSeasonMvp } from '$lib/seasons/mvp'

type TeamRel = { id: string; name: string; tag?: string | null; logo_path?: string | null }
type ProfileRel = { id: string; display_name: string | null }
type SeasonRel = { id: string; code: string; name: string }
type MatchTeamRel = { name: string; tag: string | null }
type MatchRel = {
  id: string
  scheduled_at: string | null
  team_a: MatchTeamRel | MatchTeamRel[] | null
  team_b: MatchTeamRel | MatchTeamRel[] | null
}

function firstRel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export const load = async ({ locals, url }: { locals: App.Locals; url: URL }) => {
  await requireNavPage(locals, 'hall-of-fame')
  // The whole page is one book at a time: Rivals, or one side league (an external
  // event like Shitter League). Rivals shows while a Rivals season is active; a
  // side league's book is the default only when it is the sole active season.
  // The others stay one click away via ?track=.
  const { rivals, sideLeague, display, pastSideLeagues, endedSideLeagues } =
    await loadRecordTracks()
  const candidates = [
    display,
    ...[rivals, sideLeague, ...endedSideLeagues].filter(
      (t): t is NonNullable<typeof t> => !!t && t.key !== display.key
    ),
  ]
  const requested = url.searchParams.get('track')
  const recordTrack = candidates.find((t) => t.key === requested) ?? display
  const isAdmin = locals.user?.role === 'admin'

  const [
    { data: entries, error: entriesError },
    { data: champions, error: championsError },
    trackRecords,
    viewer,
  ] = await Promise.all([
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
        profile:profiles!hall_of_fame_entries_profile_id_fkey (id, display_name),
        team:teams!hall_of_fame_entries_team_id_fkey (id, name, tag, logo_path),
        season:seasons!hall_of_fame_entries_season_id_fkey (id, code, name),
        match:matches!hall_of_fame_entries_match_id_fkey (
          id,
          scheduled_at,
          team_a:teams!matches_team_a_id_fkey (name, tag),
          team_b:teams!matches_team_b_id_fkey (name, tag)
        )
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
        metadata,
        champion_clip_url,
        winner:teams!seasons_winner_team_id_fkey (id, name, tag, logo_path),
        mvp:profiles!seasons_mvp_profile_id_fkey (id, display_name)
      `
      )
      .not('winner_team_id', 'is', null)
      .order('starts_on', { ascending: false, nullsFirst: false }),

    // Generated stat records with admin edits applied; hidden ones left out.
    loadTrackRecords(recordTrack.key),
    loadRecordViewer(locals.user?.sub),
  ])

  if (entriesError) {
    // The table may not exist yet if the migration has not been applied.
    console.error('Failed to load hall of fame entries:', entriesError)
  }
  if (championsError) {
    console.error('Failed to load season champions:', championsError)
  }
  // The editor's bookkeeping stays server-side.
  const statRecords = trackRecords.map((record) => ({
    ...record,
    categoryOverride: null,
    detachedEdits: [],
    /** The signed-in viewer is one of the ties cut off the bottom of the card. */
    viewerTiedOff: viewerIsTiedOff(record.top, record.top.at(-1)?.context ?? {}, viewer),
    top: record.top.map((entry) => ({
      ...entry,
      context: withoutTieLists(entry.context),
      override: null,
    })),
  }))

  const normalized = (entries ?? []).map((entry) => {
    const profile = firstRel(entry.profile as unknown as ProfileRel | ProfileRel[] | null)
    const team = firstRel(entry.team as unknown as TeamRel | TeamRel[] | null)
    const season = firstRel(entry.season as unknown as SeasonRel | SeasonRel[] | null)
    const match = firstRel(entry.match as unknown as MatchRel | MatchRel[] | null)
    const teamA = firstRel(match?.team_a)
    const teamB = firstRel(match?.team_b)

    return {
      id: entry.id,
      entry_type: entry.entry_type as 'record' | 'moment' | 'award',
      title: entry.title,
      description: entry.description ?? null,
      stat_value: entry.stat_value ?? null,
      stat_label: entry.stat_label ?? null,
      media_url: entry.media_url ?? null,
      holder: profile
        ? { id: profile.id, name: profile.display_name ?? 'Player' }
        : entry.player_name
          ? { id: null, name: entry.player_name }
          : null,
      team: team
        ? { id: team.id, name: team.name, tag: team.tag ?? null, logo_url: getTeamLogoUrl(team) }
        : null,
      season: season ? { code: season.code, name: season.name } : null,
      match: match
        ? {
            id: match.id,
            label: `${teamA?.tag ?? teamA?.name ?? 'TBD'} vs ${teamB?.tag ?? teamB?.name ?? 'TBD'}`,
            scheduledAt: match.scheduled_at,
          }
        : null,
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
      mvp: resolveSeasonMvp(mvp, season.metadata),
      clipUrl: season.champion_clip_url ?? null,
    }
  })

  // Which book a season belongs to: its own side league, or Rivals (every
  // rivalsN season, including the ones before stat records were tracked).
  const sideLeagueCodes = new Set(endedSideLeagues.map((t) => t.key))
  if (sideLeague) sideLeagueCodes.add(sideLeague.key)
  const trackOf = (code: string | null | undefined) =>
    code && sideLeagueCodes.has(code) ? code : RIVALS_TRACK
  const inTrack = (code: string | null | undefined) => trackOf(code) === recordTrack.key

  // An ended side league earns a tab once it has anything to show.
  const hasContent = new Set<string>([
    ...pastSideLeagues.map((t) => t.key),
    ...seasonChampions.map((c) => trackOf(c.code)),
    ...normalized.map((e) => trackOf(e.season?.code)),
  ])
  const trackOptions = candidates.filter(
    (t) =>
      t.key === display.key ||
      t.key === recordTrack.key ||
      !endedSideLeagues.some((p) => p.key === t.key) ||
      hasContent.has(t.key)
  )

  const shown = normalized.filter((e) => inTrack(e.season?.code))

  return {
    records: shown.filter((e) => e.entry_type === 'record'),
    moments: shown.filter((e) => e.entry_type === 'moment'),
    awards: shown.filter((e) => e.entry_type === 'award'),
    seasonChampions: seasonChampions.filter((c) => inTrack(c.code)),
    statRecords,
    recordTrack: {
      key: recordTrack.key,
      label: recordTrack.label,
      isSideLeague: recordTrack.isSideLeague,
    },
    trackOptions: trackOptions.map((t) => ({
      key: t.key,
      label: t.isSideLeague ? t.label : 'Rivals',
      isDefault: t.key === display.key,
      isPast: endedSideLeagues.some((p) => p.key === t.key),
      // Side leagues (Shitter League) are hidden on the client unless shown.
      isSideLeague: t.isSideLeague,
    })),
    viewer: { isAdmin },
  }
}
