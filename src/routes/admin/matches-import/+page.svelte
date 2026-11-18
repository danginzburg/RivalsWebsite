<script lang="ts">
  import { onMount } from 'svelte'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import AdminCaptainReports from '$lib/components/admin/AdminCaptainReports.svelte'
  import { readRememberedAdminSeason, rememberAdminSeason } from '$lib/admin/remembered-season'
  import {
    Upload,
    Loader2,
    AlertTriangle,
    CheckCircle2,
    Layers3,
    ArrowLeft,
    Users,
  } from 'lucide-svelte'
  import { resolve } from '$app/paths'
  import { MATCH_STAGES } from '$lib/stats/sections'

  /**
   * Which part of the competition the imported series belongs to. It decides
   * whether the match counts toward the standings and which stat batches it
   * feeds. Required before any import is saved.
   */
  const stageOptions = MATCH_STAGES.map((stage) => ({ value: stage.key, label: stage.label }))

  const riotBestOfOptions = [
    { value: '', label: 'Auto' },
    { value: '3', label: 'Bo3' },
    { value: '5', label: 'Bo5' },
  ]

  const riotRegionOptions = [
    { value: 'na', label: 'NA' },
    { value: 'eu', label: 'EU' },
    { value: 'ap', label: 'AP' },
    { value: 'kr', label: 'KR' },
    { value: 'br', label: 'BR' },
    { value: 'latam', label: 'LATAM' },
  ]

  const forfeitBestOfOptions = [
    { value: '3', label: 'Bo3' },
    { value: '5', label: 'Bo5' },
  ]

  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  type ParsedPlayerRow = {
    player_name: string
    agents: string
    acs: number
    kills: number
    deaths: number
    assists: number
    kd: number
    adr: number
    kast_pct: number
    fk: number
    fd: number
    hs_pct: number
    plants: number
    defuses: number
    econ_rating: number
    profile_id: string | null
    side: 'a' | 'b'
  }

  type ParsedMap = {
    sourceFilename: string
    teamAName: string
    teamBName: string
    scheduledAt: string
    mapName: string
    teamARounds: number
    teamBRounds: number
    playerRows: ParsedPlayerRow[]
  }

  type ImportMode = 'riot_links' | 'series_csv' | 'forfeit_no_show'

  /**
   * Tracker links are the default now that matches can be read straight from
   * Riot, but the CSV path stays exactly as it was: it is the only way to
   * import a match older than Riot's retention window, or one whose scoreboard
   * needs correcting by hand after a rollback.
   */
  let importMode = $state<ImportMode>('riot_links')

  /** Kept between imports: a run of playoff series is usually entered together. */
  let stage = $state('')

  /**
   * The season imported matches are filed under. Defaults to the active one;
   * picking a past season backfills it without having to make it active, and
   * narrows team matching to that season's teams (names carry over between
   * seasons, so an unscoped match could land on the wrong season's team).
   */
  const getInitialSeasonId = () => data.activeSeasonId ?? ''
  let importSeasonId = $state(getInitialSeasonId())

  onMount(() => {
    const remembered = readRememberedAdminSeason((data.seasons ?? []).map((s) => s.id))
    if (remembered) importSeasonId = remembered
  })

  const importSeasonOptions = $derived(
    (data.seasons ?? []).map((season) => ({
      value: season.id,
      label: `${season.name}${season.is_active ? ' (active)' : ''}`,
    }))
  )

  /**
   * The existing match the stats belong to — one scheduled by hand, or live
   * right now. Empty leaves it to the import to find the match by teams and
   * date (creating one if none is near). Picking one fixes the teams, season
   * and (by default) the stage to that match's.
   */
  type TargetMatch = (typeof data.targetMatches)[number]
  const stageLabelByKey = new Map<string, string>(MATCH_STAGES.map((s) => [s.key, s.label]))
  let targetMatchId = $state('')

  function targetMatchLabel(match: TargetMatch) {
    const teams = `${match.teamA?.name ?? 'TBD'} vs ${match.teamB?.name ?? 'TBD'}`
    const when = match.scheduledAt
      ? new Date(match.scheduledAt).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : 'unscheduled'
    const status =
      match.status === 'live'
        ? '● LIVE'
        : match.hasStats
          ? 'Has stats'
          : match.status === 'completed'
            ? 'Result only'
            : 'Scheduled'
    const stageLabel = match.stage ? (stageLabelByKey.get(match.stage) ?? match.stage) : null
    return [status, teams, when, stageLabel].filter(Boolean).join(' · ')
  }

  const targetMatchOptions = $derived([
    { value: '', label: 'Auto — find or create by teams and date' },
    ...(data.targetMatches ?? []).map((match) => ({
      value: match.id,
      label: targetMatchLabel(match),
    })),
  ])

  const targetMatch = $derived(
    (data.targetMatches ?? []).find((match) => match.id === targetMatchId) ?? null
  )

  function selectTargetMatch(id: string) {
    targetMatchId = id
    const match = (data.targetMatches ?? []).find((m) => m.id === id)
    if (!match) return
    if (match.seasonId) importSeasonId = match.seasonId
    if (match.stage) stage = match.stage
    if (match.bestOf === 3 || match.bestOf === 5) riotBestOf = String(match.bestOf)
    // The match names the teams, so the roster fallback never applies.
    riotNeedsManualTeams = false
    riotPreview = null
  }

  onMount(() => {
    if (data.requestedMatchId) selectTargetMatch(data.requestedMatchId)
  })

  const importSeasonTeams = $derived(
    (data.teams ?? []).filter((team) => !importSeasonId || team.season_id === importSeasonId)
  )

  let riotInput = $state('')
  let riotRegion = $state('na')
  /**
   * Empty means infer from the map count: four or more maps is a Bo5, anything
   * less a Bo3. Only a Bo5 swept 3-0 needs to be picked by hand.
   */
  let riotBestOf = $state('')
  let riotDryRun = $state(false)

  /**
   * A forfeited map has no Riot match id — one side conceded it, so it is entered
   * by hand and folded into the series alongside the real maps. The winner is
   * picked by team (not "team A/B", which the server only settles once the
   * rosters resolve) and mapped onto a side server-side.
   */
  let riotForfeitEnabled = $state(false)
  let riotForfeitOrder = $state(1)
  let riotForfeitWinnerTeamId = $state('')
  let riotForfeitWinnerRounds = $state(13)
  let riotForfeitLoserRounds = $state(0)
  let riotForfeitLabel = $state('')

  type RiotPreview = {
    teamA: { id: string; name: string; rosterVotes: number }
    teamB: { id: string; name: string; rosterVotes: number }
    unmatchedPlayers: string[]
    maps: Array<{
      matchId: string
      mapName: string | null
      score: string
      playerCount: number
      isForfeit?: boolean
    }>
  }

  let riotPreview = $state<RiotPreview | null>(null)

  /**
   * The two teams the forfeit winner can be, from the best source on hand: the
   * picked match, the hand-picked teams, then a preview. With none of those yet,
   * every team in the import season is offered and the server checks the pick
   * is one of the two that played.
   */
  const riotForfeitWinnerOptions = $derived.by(() => {
    const pair: Array<{ id: string; name: string }> = []
    if (targetMatch?.teamA && targetMatch?.teamB) {
      pair.push(targetMatch.teamA, targetMatch.teamB)
    } else if (riotNeedsManualTeams && riotManualTeamAId && riotManualTeamBId) {
      for (const id of [riotManualTeamAId, riotManualTeamBId]) {
        const team = importSeasonTeams.find((t) => t.id === id)
        if (team) pair.push(team)
      }
    } else if (riotPreview) {
      pair.push(riotPreview.teamA, riotPreview.teamB)
    }
    const teams = pair.length === 2 ? pair : importSeasonTeams
    return [
      { value: '', label: 'Select winning team…' },
      ...teams.map((team) => ({ value: String(team.id), label: team.name })),
    ]
  })

  // Drop a pick that is no longer one of the offered teams (e.g. a different
  // match was selected).
  $effect(() => {
    if (
      riotForfeitWinnerTeamId &&
      !riotForfeitWinnerOptions.some((o) => o.value === riotForfeitWinnerTeamId)
    ) {
      riotForfeitWinnerTeamId = ''
    }
  })

  /**
   * When the rosters can't identify the teams the server asks for them by hand:
   * the admin picks the two teams from the import season, and the import reruns
   * with those ids. Kept separate from a plain error so the picker can appear.
   */
  let riotNeedsManualTeams = $state(false)
  let riotManualReason = $state<string | null>(null)
  let riotManualUnmatched = $state<string[]>([])
  let riotManualTeamAId = $state('')
  let riotManualTeamBId = $state('')

  const manualTeamOptions = $derived([
    { value: '', label: 'Select team…' },
    ...importSeasonTeams.map((team) => ({
      value: team.id,
      label: `${team.name}${team.tag ? ` [${team.tag}]` : ''}`,
    })),
  ])

  /** Preview first, then import — the failure worth catching is wrong teams. */
  async function runRiotImport(dryRun: boolean) {
    if (!dryRun && !stage) {
      parseError = 'Select a stage before importing.'
      return
    }
    isSubmitting = true
    riotDryRun = dryRun
    parseError = null
    submitMessage = null

    const manualTeams =
      riotNeedsManualTeams && riotManualTeamAId && riotManualTeamBId
        ? { teamAId: riotManualTeamAId, teamBId: riotManualTeamBId }
        : {}

    if (riotForfeitEnabled && !riotForfeitWinnerTeamId) {
      parseError = 'Pick which team won the forfeited map.'
      isSubmitting = false
      riotDryRun = false
      return
    }

    const forfeitMap = riotForfeitEnabled
      ? {
          forfeitMap: {
            order: riotForfeitOrder,
            winnerTeamId: riotForfeitWinnerTeamId,
            winnerRounds: riotForfeitWinnerRounds,
            loserRounds: riotForfeitLoserRounds,
            ...(riotForfeitLabel.trim() ? { label: riotForfeitLabel.trim() } : {}),
          },
        }
      : {}

    try {
      const response = await fetch('/api/admin/matches/import-riot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: riotInput,
          region: riotRegion,
          dryRun,
          ...(riotBestOf ? { bestOf: Number(riotBestOf) } : {}),
          ...(stage ? { stage } : {}),
          ...(importSeasonId ? { seasonId: importSeasonId } : {}),
          ...(targetMatchId ? { targetMatchId } : {}),
          ...manualTeams,
          ...forfeitMap,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (payload?.needsManualTeams) {
          riotNeedsManualTeams = true
          riotManualReason = payload.reason ?? 'Could not identify both teams.'
          riotManualUnmatched = payload.unmatchedPlayers ?? []
          return
        }
        throw new Error(payload?.message ?? 'Import failed')
      }

      // A clean run means the teams resolved — retire any manual prompt.
      riotNeedsManualTeams = false
      riotPreview = payload.preview ?? null
      submitMessage = dryRun
        ? 'Preview only — nothing has been saved yet.'
        : `Imported ${payload.preview?.maps?.length ?? 0} map(s) for ${payload.preview?.teamA?.name} vs ${payload.preview?.teamB?.name}.`
      if (!dryRun) {
        riotInput = ''
        riotManualTeamAId = ''
        riotManualTeamBId = ''
        targetMatchId = ''
      }
    } catch (err) {
      parseError = err instanceof Error ? err.message : 'Import failed'
    } finally {
      isSubmitting = false
      riotDryRun = false
    }
  }
  let fileName = $state('')
  let displayName = $state('')
  let seriesMaps = $state<ParsedMap[]>([])
  let parseError = $state<string | null>(null)
  let submitMessage = $state<string | null>(null)
  let isSubmitting = $state(false)

  let officialWinnerSide = $state<'map' | 'a' | 'b'>('map')
  let forfeitReason = $state('')
  let mapNoteByOrder = $state<Record<string, string>>({})

  let ffTeamAId = $state('')
  let ffTeamBId = $state('')
  let ffScheduledAt = $state('')
  let ffWinnerTeamId = $state('')
  let ffTeamAScore = $state(2)
  let ffTeamBScore = $state(0)
  let ffBestOf = $state(3)

  function normalizeKey(value: unknown) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  }

  function normalizeBase(value: unknown) {
    return normalizeKey(String(value ?? '').split('#')[0] ?? '')
  }

  function sameTeams(first: ParsedMap, next: ParsedMap) {
    const a = [normalizeKey(first.teamAName), normalizeKey(first.teamBName)].sort()
    const b = [normalizeKey(next.teamAName), normalizeKey(next.teamBName)].sort()
    return a[0] === b[0] && a[1] === b[1]
  }

  function isFlippedAgainst(first: ParsedMap, next: ParsedMap) {
    return (
      normalizeKey(next.teamAName) === normalizeKey(first.teamBName) &&
      normalizeKey(next.teamBName) === normalizeKey(first.teamAName)
    )
  }

  const profileMap = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- key/value lookup for CSV matching
    const map = new Map<string, string>()
    for (const profile of data.profiles ?? []) {
      for (const name of [profile.display_name, ...(profile.riot_ids ?? [])]) {
        if (!name) continue
        map.set(normalizeKey(name), profile.id)
        map.set(normalizeBase(name), profile.id)
      }
    }
    return map
  })

  const teamNameMap = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- key/value lookup for CSV matching
    const map = new Map<string, string>()
    for (const team of importSeasonTeams) {
      map.set(normalizeKey(team.name), team.id)
      const meta = team.metadata as Record<string, unknown> | null | undefined
      const aliases = meta?.match_import_names
      if (Array.isArray(aliases)) {
        for (const a of aliases) {
          const s = String(a ?? '').trim()
          if (s) map.set(normalizeKey(s), team.id)
        }
      }
    }
    return map
  })

  const mapWinnerTeamId = $derived.by(() => {
    const first = seriesMaps[0] ?? null
    if (!first) return null as string | null
    const idA = teamNameMap.get(normalizeKey(first.teamAName)) ?? null
    const idB = teamNameMap.get(normalizeKey(first.teamBName)) ?? null
    if (!idA || !idB) return null

    const canonicalizedMaps = seriesMaps.map((map) => {
      const flipped = isFlippedAgainst(first, map)
      return {
        canonicalTeamARounds: flipped ? map.teamBRounds : map.teamARounds,
        canonicalTeamBRounds: flipped ? map.teamARounds : map.teamBRounds,
      }
    })
    const winsA = canonicalizedMaps.filter(
      (m) => m.canonicalTeamARounds > m.canonicalTeamBRounds
    ).length
    const winsB = canonicalizedMaps.filter(
      (m) => m.canonicalTeamBRounds > m.canonicalTeamARounds
    ).length
    if (winsA === winsB) return null
    return winsA > winsB ? idA : idB
  })

  const seriesSummary = $derived.by(() => {
    const first = seriesMaps[0] ?? null
    const matchedPlayers = seriesMaps
      .flatMap((map) => map.playerRows)
      .filter((row) => row.profile_id).length
    const totalPlayers = seriesMaps.flatMap((map) => map.playerRows).length
    const canonicalizedMaps = first
      ? seriesMaps.map((map) => {
          const flipped = isFlippedAgainst(first, map)
          return {
            ...map,
            canonicalTeamARounds: flipped ? map.teamBRounds : map.teamARounds,
            canonicalTeamBRounds: flipped ? map.teamARounds : map.teamBRounds,
          }
        })
      : []
    const seriesWinsA = canonicalizedMaps.filter(
      (map) => map.canonicalTeamARounds > map.canonicalTeamBRounds
    ).length
    const seriesWinsB = canonicalizedMaps.filter(
      (map) => map.canonicalTeamBRounds > map.canonicalTeamARounds
    ).length
    const teamsMatched =
      (first && teamNameMap.get(normalizeKey(first.teamAName)) ? 1 : 0) +
      (first && teamNameMap.get(normalizeKey(first.teamBName)) ? 1 : 0)
    return {
      first,
      mapCount: seriesMaps.length,
      totalPlayers,
      matchedPlayers,
      unmatchedPlayers: totalPlayers - matchedPlayers,
      teamsMatched,
      seriesWinsA,
      seriesWinsB,
    }
  })

  const showForfeitExtras = $derived.by(() => {
    const first = seriesMaps[0] ?? null
    if (!first || officialWinnerSide === 'map') return false
    const idA = teamNameMap.get(normalizeKey(first.teamAName)) ?? null
    const idB = teamNameMap.get(normalizeKey(first.teamBName)) ?? null
    const officialTeamId =
      officialWinnerSide === 'a' ? idA : officialWinnerSide === 'b' ? idB : null
    if (!officialTeamId) return false
    return mapWinnerTeamId === null || officialTeamId !== mapWinnerTeamId
  })

  function parseNumber(value: string) {
    const n = Number(
      String(value ?? '')
        .replace('%', '')
        .trim()
    )
    return Number.isFinite(n) ? n : 0
  }

  function parseCsv(fileName: string, text: string): ParsedMap {
    const lines = text.split(/\r?\n/)
    const meaningful = lines.map((line) => line.trim()).filter(Boolean)
    if (meaningful.length < 3)
      throw new Error(`${fileName}: CSV must include headers, players, and summary rows`)

    const header = lines[0].split(',').map((part) => part.trim().toUpperCase())
    const required = [
      'AGENT',
      'PLAYER',
      'AVG COMBAT SCORE',
      'K',
      'D',
      'A',
      'K/D',
      'ADR',
      'KAST',
      'FK',
      'FD',
      'HS%',
      'PLANTS',
      'DEFUSES',
      'ECON RATING',
    ]
    for (const column of required) {
      if (!header.includes(column))
        throw new Error(`${fileName}: missing required column ${column}`)
    }

    const playerLines: string[] = []
    let footerLine = ''
    for (let i = 1; i < lines.length; i++) {
      const rawLine = lines[i]
      const parts = rawLine.split(',').map((part) => part.trim())
      const hasAnyValue = parts.some((part) => part.length > 0)
      if (!hasAnyValue) continue
      if (parts[2] && !Number.isFinite(Number(parts[2]))) {
        footerLine = rawLine
        break
      }
      playerLines.push(rawLine)
    }

    if (playerLines.length === 0 || !footerLine)
      throw new Error(`${fileName}: could not find player rows and footer row`)

    const footer = footerLine.split(',').map((part) => part.trim())
    const teamAName = footer[0] ?? ''
    const teamBName = footer[1] ?? ''
    const scheduledAt = footer[2] ?? ''
    const teamARounds = parseNumber(footer[3])
    const teamBRounds = parseNumber(footer[5])
    const mapName = footer[7] ?? ''
    const half = Math.ceil(playerLines.length / 2)

    const playerRows = playerLines.map((line, index) => {
      const parts = line.split(',').map((part) => part.trim())
      const playerName = parts[1] ?? ''
      return {
        player_name: playerName,
        agents: parts[0] ?? '',
        acs: parseNumber(parts[2]),
        kills: parseNumber(parts[3]),
        deaths: parseNumber(parts[4]),
        assists: parseNumber(parts[5]),
        kd: parseNumber(parts[6]),
        adr: parseNumber(parts[7]),
        kast_pct: parseNumber(parts[8]),
        fk: parseNumber(parts[9]),
        fd: parseNumber(parts[10]),
        hs_pct: parseNumber(parts[12]),
        plants: parseNumber(parts[13]),
        defuses: parseNumber(parts[14]),
        econ_rating: parseNumber(parts[15]),
        profile_id:
          profileMap.get(normalizeKey(playerName)) ??
          profileMap.get(normalizeBase(playerName)) ??
          null,
        side: index < half ? 'a' : 'b',
      } satisfies ParsedPlayerRow
    })

    return {
      sourceFilename: fileName,
      teamAName,
      teamBName,
      scheduledAt,
      mapName,
      teamARounds,
      teamBRounds,
      playerRows,
    }
  }

  async function handleFiles(files: FileList) {
    parseError = null
    submitMessage = null
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return
    fileName = fileArray.length === 1 ? fileArray[0].name : `${fileArray.length} map files`
    if (!displayName.trim())
      displayName = fileArray.length === 1 ? fileArray[0].name : 'Series Import'

    try {
      const parsed = await Promise.all(
        fileArray.map(async (file) => parseCsv(file.name, await file.text()))
      )

      const first = parsed[0]
      for (const [index, map] of parsed.entries()) {
        if (!sameTeams(first, map)) {
          throw new Error(`Map ${index + 1} teams do not match the first uploaded map`)
        }
        if (normalizeKey(map.scheduledAt) !== normalizeKey(first.scheduledAt)) {
          throw new Error(`Map ${index + 1} date does not match the first uploaded map`)
        }
      }

      seriesMaps = parsed
    } catch (err) {
      parseError = err instanceof Error ? err.message : 'Failed to parse match CSVs'
      seriesMaps = []
    }
  }

  async function submitImport() {
    if (!stage) {
      submitMessage = null
      parseError = 'Select a stage before importing.'
      return
    }
    isSubmitting = true
    submitMessage = null
    try {
      if (importMode === 'forfeit_no_show') {
        const teams = importSeasonTeams
        const teamA = teams.find((t) => t.id === ffTeamAId)
        const teamB = teams.find((t) => t.id === ffTeamBId)
        if (!teamA || !teamB) throw new Error('Select both teams for the forfeit.')
        if (teamA.id === teamB.id) throw new Error('Teams must be different.')
        const response = await window.fetch('/api/admin/matches/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            importKind: 'forfeit_no_show',
            displayName: displayName.trim() || 'forfeit-no-show',
            teamAName: teamA.name,
            teamBName: teamB.name,
            scheduledAt: ffScheduledAt.trim(),
            winnerTeamId: ffWinnerTeamId.trim(),
            teamAScore: ffTeamAScore,
            teamBScore: ffTeamBScore,
            bestOf: ffBestOf,
            ...(stage ? { stage } : {}),
            ...(importSeasonId ? { seasonId: importSeasonId } : {}),
          }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message ?? 'Failed to record forfeit')
        submitMessage = `Forfeit match saved (match id ${result.matchId ?? '—'}).`
        return
      }

      const first = seriesMaps[0] ?? null
      const idA = first ? teamNameMap.get(normalizeKey(first.teamAName)) : null
      const idB = first ? teamNameMap.get(normalizeKey(first.teamBName)) : null

      const officialTeamId =
        officialWinnerSide === 'a' ? idA : officialWinnerSide === 'b' ? idB : null

      if (seriesSummary.seriesWinsA === seriesSummary.seriesWinsB) {
        if (officialWinnerSide === 'map' || !officialTeamId) {
          throw new Error(
            'Series is tied on maps — choose an official series winner (Team A or B).'
          )
        }
      }

      const sendOfficial =
        Boolean(officialTeamId) && (mapWinnerTeamId === null || officialTeamId !== mapWinnerTeamId)

      const mapNotes =
        Object.keys(mapNoteByOrder).length > 0
          ? Object.fromEntries(
              Object.entries(mapNoteByOrder).filter(([, v]) => String(v).trim().length > 0)
            )
          : undefined

      const response = await window.fetch('/api/admin/matches/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          bestOf: seriesMaps.length >= 4 ? 5 : 3,
          maps: seriesMaps,
          ...(stage ? { stage } : {}),
          ...(importSeasonId ? { seasonId: importSeasonId } : {}),
          ...(targetMatchId ? { targetMatchId } : {}),
          ...(sendOfficial && officialTeamId ? { officialWinnerTeamId: officialTeamId } : {}),
          ...(sendOfficial && forfeitReason.trim() ? { forfeitReason: forfeitReason.trim() } : {}),
          ...(sendOfficial && mapNotes && Object.keys(mapNotes).length > 0 ? { mapNotes } : {}),
        }),
      })

      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message ?? 'Failed to import series CSVs')

      submitMessage = result.unresolvedPlayers?.length
        ? `Imported ${result.mapIds?.length ?? seriesMaps.length} maps. Unmatched players: ${result.unresolvedPlayers.join(', ')}`
        : `Imported ${result.mapIds?.length ?? seriesMaps.length} maps successfully.`
      seriesMaps = []
      fileName = ''
      displayName = ''
      targetMatchId = ''
      officialWinnerSide = 'map'
      forfeitReason = ''
      mapNoteByOrder = {}
    } catch (err) {
      submitMessage = err instanceof Error ? err.message : 'Failed to import series CSVs'
    } finally {
      isSubmitting = false
    }
  }
</script>

<PageContainer>
  <div class="flex justify-center py-6 sm:py-8">
    <div class="w-full max-w-6xl space-y-5">
      <header class="admin-import-head">
        <div class="min-w-0">
          <h1 class="admin-import-title">Match Import</h1>
          <p class="admin-hint mt-1">
            Upload all maps from a BO3/BO5 series together, or record a no-show forfeit without
            player stats. Series CSV import can override the official winner (e.g. rule violation)
            while keeping played map scores.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <a href={resolve('/admin/riot-identities')} class="admin-back-link">
            <Users size={14} /> Player identities
          </a>
          <a href={resolve('/admin')} class="admin-back-link">
            <ArrowLeft size={14} /> Admin
          </a>
        </div>
      </header>

      <AdminCaptainReports reports={data.captainReports ?? []} />

      <section class="admin-card admin-card-pad">
        <div class="mb-4 flex flex-wrap gap-4 text-sm" style="color: var(--text);">
          <label class="inline-flex cursor-pointer items-center gap-2">
            <input type="radio" bind:group={importMode} value="riot_links" />
            <span>Tracker links / match ids</span>
          </label>
          <label class="inline-flex cursor-pointer items-center gap-2">
            <input type="radio" bind:group={importMode} value="series_csv" />
            <span>Series (map CSVs)</span>
          </label>
          <label class="inline-flex cursor-pointer items-center gap-2">
            <input type="radio" bind:group={importMode} value="forfeit_no_show" />
            <span>No-show forfeit (no stats)</span>
          </label>
        </div>

        {#if importMode !== 'forfeit_no_show'}
          <div class="mb-4">
            <div class="admin-field-label">Import into match</div>
            <CustomSelect
              options={targetMatchOptions}
              value={targetMatchId}
              onSelect={selectTargetMatch}
              placeholder="Auto — find or create by teams and date"
              disabled={isSubmitting}
            />
            <p class="mt-1 text-xs" style="color: rgba(255,255,255,0.6);">
              {#if targetMatch}
                Stats attach to this match: its teams are used as-is, and its season is kept. The
                maps must be {targetMatch.teamA?.name} vs {targetMatch.teamB?.name}.
                {#if targetMatch.hasStats}
                  This match already has map stats — importing replaces them.
                {/if}
              {:else if (data.targetMatches ?? []).length === 0}
                No live or recent matches are waiting on stats. The import will find or create the
                match by teams and date.
              {:else}
                Live matches and ones from the last three weeks with no map stats yet. Leave on Auto
                to match by teams and date.
              {/if}
            </p>
          </div>
        {/if}

        {#if importMode === 'riot_links'}
          <div class="riot-import">
            <label class="block text-sm" style="color: var(--text);">
              <span class="mb-1 block font-semibold">Tracker links or Riot match ids</span>
              <textarea
                bind:value={riotInput}
                rows="4"
                class="admin-input w-full font-mono text-xs"
                placeholder="https://tracker.gg/valorant/match/…&#10;https://tracker.gg/valorant/match/…"
                disabled={isSubmitting}
              ></textarea>
              <span class="mt-1 block text-xs" style="color: rgba(255,255,255,0.6);">
                One per line, in map order. Teams and scores are read from the match itself.
              </span>
            </label>

            <div class="mt-3 flex flex-wrap items-end gap-3">
              <label class="block text-sm" style="color: var(--text);">
                <span class="mb-1 block font-semibold">Region</span>
                <div class="w-28">
                  <CustomSelect
                    options={riotRegionOptions}
                    bind:value={riotRegion}
                    disabled={isSubmitting}
                  />
                </div>
              </label>

              <label class="block text-sm" style="color: var(--text);">
                <span class="mb-1 block font-semibold">Best of</span>
                <div class="w-28">
                  <CustomSelect
                    options={riotBestOfOptions}
                    bind:value={riotBestOf}
                    placeholder="Auto"
                    disabled={isSubmitting}
                  />
                </div>
              </label>

              <button
                type="button"
                class="admin-btn admin-btn-neutral text-sm"
                onclick={() => runRiotImport(true)}
                disabled={isSubmitting || riotInput.trim().length === 0}
              >
                {#if isSubmitting && riotDryRun}
                  <span class="inline-flex items-center gap-2">
                    <Loader2 size={16} class="animate-spin" /> Checking…
                  </span>
                {:else}
                  Preview
                {/if}
              </button>
            </div>

            <div class="mt-3 rounded-md border p-3" style="border-color: rgba(255,255,255,0.14);">
              <label
                class="inline-flex cursor-pointer items-center gap-2 text-sm"
                style="color: var(--text);"
              >
                <input type="checkbox" bind:checked={riotForfeitEnabled} disabled={isSubmitting} />
                <span class="font-semibold">Include a forfeited map (no game id)</span>
              </label>
              <p class="mt-1 text-xs leading-relaxed" style="color: rgba(255,255,255,0.6);">
                For a map one team conceded, so there is no tracker link for it. It is added to the
                series with its scoreline but no player stats.
              </p>

              {#if riotForfeitEnabled}
                <div class="mt-3 flex flex-wrap items-end gap-3">
                  <label class="block text-sm" style="color: var(--text);">
                    <span
                      class="mb-1 block text-xs font-semibold uppercase"
                      style="color: rgba(255,255,255,0.7);">Map position</span
                    >
                    <input
                      type="number"
                      min="1"
                      bind:value={riotForfeitOrder}
                      class="admin-input w-24"
                      disabled={isSubmitting}
                    />
                  </label>

                  <label class="block text-sm" style="color: var(--text);">
                    <span
                      class="mb-1 block text-xs font-semibold uppercase"
                      style="color: rgba(255,255,255,0.7);">Winner</span
                    >
                    <div class="w-56">
                      <CustomSelect
                        options={riotForfeitWinnerOptions}
                        value={riotForfeitWinnerTeamId}
                        onSelect={(v) => (riotForfeitWinnerTeamId = String(v))}
                        disabled={isSubmitting}
                      />
                    </div>
                  </label>

                  <label class="block text-sm" style="color: var(--text);">
                    <span
                      class="mb-1 block text-xs font-semibold uppercase"
                      style="color: rgba(255,255,255,0.7);">Winner rounds</span
                    >
                    <input
                      type="number"
                      min="0"
                      bind:value={riotForfeitWinnerRounds}
                      class="admin-input w-24"
                      disabled={isSubmitting}
                    />
                  </label>

                  <label class="block text-sm" style="color: var(--text);">
                    <span
                      class="mb-1 block text-xs font-semibold uppercase"
                      style="color: rgba(255,255,255,0.7);">Loser rounds</span
                    >
                    <input
                      type="number"
                      min="0"
                      bind:value={riotForfeitLoserRounds}
                      class="admin-input w-24"
                      disabled={isSubmitting}
                    />
                  </label>
                </div>

                <label class="mt-3 block text-sm" style="color: var(--text);">
                  <span
                    class="mb-1 block text-xs font-semibold uppercase"
                    style="color: rgba(255,255,255,0.7);">Note (optional)</span
                  >
                  <input
                    bind:value={riotForfeitLabel}
                    class="admin-input"
                    placeholder="Shown on the match page for this map, e.g. Opponent no-show"
                    disabled={isSubmitting}
                  />
                </label>

                {#if !riotPreview}
                  <p class="mt-2 text-xs" style="color: rgba(255,255,255,0.6);">
                    Team A and Team B are identified when you Preview — check the winner side
                    matches the names shown there before importing.
                  </p>
                {/if}
              {/if}
            </div>

            <p class="mt-3 text-xs leading-relaxed" style="color: rgba(255,255,255,0.6);">
              Riot keeps match details for roughly two months, so import a series while it is
              recent. Older matches are gone from Riot's side — use the map CSVs for those.
            </p>

            {#if riotPreview}
              <div class="admin-subcard mt-3 rounded-md border p-3 text-sm">
                <div class="font-semibold" style="color: var(--text);">
                  {riotPreview.teamA.name} vs {riotPreview.teamB.name}
                </div>
                <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.7);">
                  Identified from {riotPreview.teamA.rosterVotes} and {riotPreview.teamB
                    .rosterVotes} players on the rosters.
                </div>
                <ul class="mt-2 space-y-1 text-xs" style="color: rgba(255,255,255,0.8);">
                  {#each riotPreview.maps as map, index (map.matchId)}
                    <li>
                      Map {index + 1}: <strong>{map.mapName ?? 'Unknown'}</strong>
                      {map.score}
                      {#if map.isForfeit}
                        <span style="color: #fbbf24;">(forfeit — no stats)</span>
                      {:else}
                        <span style="color: rgba(255,255,255,0.5);"
                          >({map.playerCount} players)</span
                        >
                      {/if}
                    </li>
                  {/each}
                </ul>
                {#if riotPreview.unmatchedPlayers.length > 0}
                  <div class="mt-2 text-xs" style="color: #fbbf24;">
                    Not on any roster, so they import by name only:
                    {riotPreview.unmatchedPlayers.join(', ')}
                  </div>
                {/if}
              </div>
            {/if}

            {#if riotNeedsManualTeams}
              <div class="admin-alert admin-alert-warn mt-3 space-y-3">
                <div class="text-sm font-semibold" style="color: var(--text);">
                  Pick the teams by hand
                </div>
                <p class="text-xs leading-relaxed" style="color: rgba(255,255,255,0.72);">
                  {riotManualReason}
                </p>
                {#if riotManualUnmatched.length > 0}
                  <p class="text-xs" style="color: #fbbf24;">
                    Unrecognised players: {riotManualUnmatched.join(', ')}
                  </p>
                {/if}

                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label class="block text-sm" style="color: var(--text);">
                    <span
                      class="mb-1 block text-xs font-semibold uppercase"
                      style="color: rgba(255,255,255,0.7);">Team A</span
                    >
                    <CustomSelect
                      options={manualTeamOptions}
                      bind:value={riotManualTeamAId}
                      placeholder="Select team…"
                      disabled={isSubmitting}
                    />
                  </label>
                  <label class="block text-sm" style="color: var(--text);">
                    <span
                      class="mb-1 block text-xs font-semibold uppercase"
                      style="color: rgba(255,255,255,0.7);">Team B</span
                    >
                    <CustomSelect
                      options={manualTeamOptions}
                      bind:value={riotManualTeamBId}
                      placeholder="Select team…"
                      disabled={isSubmitting}
                    />
                  </label>
                </div>

                <div class="flex flex-wrap gap-3">
                  <button
                    type="button"
                    class="admin-btn admin-btn-neutral text-sm"
                    onclick={() => runRiotImport(true)}
                    disabled={isSubmitting ||
                      !riotManualTeamAId ||
                      !riotManualTeamBId ||
                      riotManualTeamAId === riotManualTeamBId}
                  >
                    {#if isSubmitting && riotDryRun}
                      <span class="inline-flex items-center gap-2">
                        <Loader2 size={16} class="animate-spin" /> Checking…
                      </span>
                    {:else}
                      Preview with these teams
                    {/if}
                  </button>
                  <button
                    type="button"
                    class="admin-btn admin-btn-info text-sm"
                    onclick={() => runRiotImport(false)}
                    disabled={isSubmitting ||
                      !stage ||
                      !riotManualTeamAId ||
                      !riotManualTeamBId ||
                      riotManualTeamAId === riotManualTeamBId}
                  >
                    {#if isSubmitting && !riotDryRun}
                      <span class="inline-flex items-center gap-2">
                        <Loader2 size={16} class="animate-spin" /> Saving…
                      </span>
                    {:else}
                      Import with these teams
                    {/if}
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/if}

        {#if importMode === 'forfeit_no_show'}
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label class="block text-sm" style="color: var(--text);">
              <span
                class="mb-1 block text-xs font-semibold uppercase"
                style="color: rgba(255,255,255,0.7);">Team A</span
              >
              <select bind:value={ffTeamAId} class="admin-input">
                <option value="">Select team…</option>
                {#each importSeasonTeams as team (team.id)}
                  <option value={team.id}>{team.name}{team.tag ? ` [${team.tag}]` : ''}</option>
                {/each}
              </select>
            </label>
            <label class="block text-sm" style="color: var(--text);">
              <span
                class="mb-1 block text-xs font-semibold uppercase"
                style="color: rgba(255,255,255,0.7);">Team B</span
              >
              <select bind:value={ffTeamBId} class="admin-input">
                <option value="">Select team…</option>
                {#each importSeasonTeams as team (team.id)}
                  <option value={team.id}>{team.name}{team.tag ? ` [${team.tag}]` : ''}</option>
                {/each}
              </select>
            </label>
            <label class="block text-sm md:col-span-2" style="color: var(--text);">
              <span
                class="mb-1 block text-xs font-semibold uppercase"
                style="color: rgba(255,255,255,0.7);">Match date</span
              >
              <input
                bind:value={ffScheduledAt}
                placeholder="DD/MM/YYYY or ISO date"
                class="admin-input"
              />
            </label>
            <label class="block text-sm md:col-span-2" style="color: var(--text);">
              <span
                class="mb-1 block text-xs font-semibold uppercase"
                style="color: rgba(255,255,255,0.7);">Winner</span
              >
              <select bind:value={ffWinnerTeamId} class="admin-input">
                <option value="">Select winner…</option>
                {#if ffTeamAId}
                  <option value={ffTeamAId}
                    >{(data.teams ?? []).find((t) => t.id === ffTeamAId)?.name ?? 'Team A'}</option
                  >
                {/if}
                {#if ffTeamBId}
                  <option value={ffTeamBId}
                    >{(data.teams ?? []).find((t) => t.id === ffTeamBId)?.name ?? 'Team B'}</option
                  >
                {/if}
              </select>
            </label>
            <label class="block text-sm" style="color: var(--text);">
              <span
                class="mb-1 block text-xs font-semibold uppercase"
                style="color: rgba(255,255,255,0.7);">Score (team A)</span
              >
              <input type="number" min="0" bind:value={ffTeamAScore} class="admin-input" />
            </label>
            <label class="block text-sm" style="color: var(--text);">
              <span
                class="mb-1 block text-xs font-semibold uppercase"
                style="color: rgba(255,255,255,0.7);">Score (team B)</span
              >
              <input type="number" min="0" bind:value={ffTeamBScore} class="admin-input" />
            </label>
            <label class="block text-sm md:col-span-2" style="color: var(--text);">
              <span
                class="mb-1 block text-xs font-semibold uppercase"
                style="color: rgba(255,255,255,0.7);">Best of</span
              >
              <div class="max-w-xs">
                <CustomSelect
                  options={forfeitBestOfOptions}
                  value={String(ffBestOf)}
                  onSelect={(v) => (ffBestOf = Number(v))}
                />
              </div>
            </label>
          </div>
        {:else}
          <label class="admin-dropzone">
            <Upload size={16} />
            <span>{fileName || 'Choose one or more map CSVs'}</span>
            <input
              type="file"
              accept=".csv"
              multiple
              class="hidden"
              onchange={(event) => {
                const files = (event.currentTarget as HTMLInputElement).files
                if (files) handleFiles(files)
              }}
            />
          </label>
        {/if}

        <div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[16rem_16rem_1fr]">
          <label class="block">
            <div class="admin-field-label">Season</div>
            <CustomSelect
              options={importSeasonOptions}
              value={importSeasonId}
              onSelect={(value) => {
                importSeasonId = value
                rememberAdminSeason(value)
              }}
              placeholder="Select a season"
              disabled={isSubmitting ||
                (Boolean(targetMatch?.seasonId) && importMode !== 'forfeit_no_show')}
            />
          </label>
          <label class="block">
            <div class="admin-field-label">Stage</div>
            <CustomSelect
              options={stageOptions}
              bind:value={stage}
              placeholder="Select a stage (required)"
              disabled={isSubmitting}
            />
          </label>
          <label class="block">
            <div class="admin-field-label">Display Name</div>
            <input bind:value={displayName} class="admin-input" placeholder="Series Import" />
          </label>
        </div>
        <p class="mt-1 text-xs" style="color: rgba(255,255,255,0.6);">
          A stage is required to import. Only Regular Season matches count toward the standings. The
          stage also picks which live stat batches the match feeds. Pick a past season to backfill
          it — it does not need to be active, and teams are matched against that season only.
        </p>

        {#if parseError}
          <div class="admin-alert admin-alert-error mt-3">
            {parseError}
          </div>
        {/if}
        {#if submitMessage}
          <div class="admin-note mt-3">
            {submitMessage}
          </div>
        {/if}
      </section>

      {#if importMode === 'series_csv'}
        <section class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div class="admin-stat">
            <div class="admin-stat-label">
              <Layers3 size={16} /> Maps
            </div>
            <div class="admin-stat-value">
              {seriesSummary.mapCount}
            </div>
          </div>
          <div class="admin-stat">
            <div class="admin-stat-label">
              <CheckCircle2 size={16} /> Matched Players
            </div>
            <div class="admin-stat-value" style="color: var(--good-text);">
              {seriesSummary.matchedPlayers}
            </div>
          </div>
          <div class="admin-stat">
            <div class="admin-stat-label">
              <AlertTriangle size={16} /> Unmatched Players
            </div>
            <div class="admin-stat-value" style="color: var(--bad-text);">
              {seriesSummary.unmatchedPlayers}
            </div>
          </div>
          <div class="admin-stat">
            <div class="admin-stat-label">
              <CheckCircle2 size={16} /> Teams Matched
            </div>
            <div class="admin-stat-value">
              {seriesSummary.teamsMatched}/2
            </div>
          </div>
        </section>
      {/if}

      <section class="admin-card admin-card-pad">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-semibold" style="color: var(--text);">
              {#if importMode === 'forfeit_no_show'}No-show forfeit{:else if importMode === 'riot_links'}Riot
                import{:else}Series Summary{/if}
            </div>
            <div class="mt-1 text-xs leading-relaxed" style="color: rgba(255,255,255,0.72);">
              {#if importMode === 'forfeit_no_show'}
                Save a completed match with no map stats (e.g. opponent no-show).
              {:else if importMode === 'riot_links'}
                Preview first to check the teams were identified correctly, then import.
              {:else}
                Review the series-level match info and each imported map below.
              {/if}
            </div>
          </div>
          <button
            type="button"
            class="admin-btn admin-btn-info text-sm"
            onclick={() => (importMode === 'riot_links' ? runRiotImport(false) : submitImport())}
            disabled={isSubmitting ||
              !stage ||
              (importMode === 'series_csv' && seriesMaps.length === 0) ||
              (importMode === 'riot_links' && riotInput.trim().length === 0) ||
              (importMode === 'forfeit_no_show' &&
                (!ffTeamAId || !ffTeamBId || !ffScheduledAt.trim() || !ffWinnerTeamId))}
          >
            {#if isSubmitting}<span class="inline-flex items-center gap-2"
                ><Loader2 size={16} class="animate-spin" /> Saving…</span
              >{:else if importMode === 'forfeit_no_show'}Save forfeit match{:else}Import Series{/if}
          </button>
        </div>

        {#if importMode === 'series_csv' && seriesSummary.first}
          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div class="admin-subcard rounded-md border p-3">
              <div
                class="text-xs font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.7);"
              >
                Teams
              </div>
              <div class="mt-1 font-semibold" style="color: var(--text);">
                {seriesSummary.first.teamAName} vs {seriesSummary.first.teamBName}
              </div>
            </div>
            <div class="admin-subcard rounded-md border p-3">
              <div
                class="text-xs font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.7);"
              >
                Series Score
              </div>
              <div class="mt-1 font-semibold" style="color: var(--text);">
                {seriesSummary.seriesWinsA}-{seriesSummary.seriesWinsB}
              </div>
            </div>
            <div class="admin-subcard rounded-md border p-3">
              <div
                class="text-xs font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.7);"
              >
                Date
              </div>
              <div class="mt-1 font-semibold" style="color: var(--text);">
                {seriesSummary.first.scheduledAt || '—'}
              </div>
            </div>
          </div>

          {#if seriesSummary.teamsMatched === 2}
            <div class="admin-alert admin-alert-warn mt-4 space-y-2">
              <div class="text-sm font-semibold" style="color: var(--text);">
                Official series winner
              </div>
              <p class="text-xs leading-relaxed" style="color: rgba(255,255,255,0.72);">
                Map-derived winner (from round scores):
                {#if mapWinnerTeamId}
                  {mapWinnerTeamId === teamNameMap.get(normalizeKey(seriesSummary.first.teamAName))
                    ? seriesSummary.first.teamAName
                    : seriesSummary.first.teamBName}
                {:else}
                  Tie — choose the official winner below.
                {/if}
              </p>
              <label class="block text-sm" style="color: var(--text);">
                <span
                  class="mb-1 block text-xs font-semibold uppercase"
                  style="color: rgba(255,255,255,0.7);">Series winner</span
                >
                <select bind:value={officialWinnerSide} class="admin-input max-w-md">
                  <option value="map">Same as map result</option>
                  <option value="a">{seriesSummary.first.teamAName} (footer team A)</option>
                  <option value="b">{seriesSummary.first.teamBName} (footer team B)</option>
                </select>
              </label>
              {#if showForfeitExtras}
                <label class="block text-sm" style="color: var(--text);">
                  <span
                    class="mb-1 block text-xs font-semibold uppercase"
                    style="color: rgba(255,255,255,0.7);">Note (optional)</span
                  >
                  <input
                    bind:value={forfeitReason}
                    class="admin-input"
                    placeholder="e.g. Rule violation — series awarded to opponent"
                  />
                </label>
              {/if}
            </div>
          {/if}

          <div class="mt-4 space-y-3">
            {#each seriesMaps as map, index (map.sourceFilename + ':' + index)}
              <div class="admin-subcard rounded-md border p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="font-semibold" style="color: var(--text);">
                    Map {index + 1}: {map.mapName || '—'}
                  </div>
                  <div class="text-sm" style="color: rgba(255,255,255,0.78);">
                    {map.teamARounds}-{map.teamBRounds}
                  </div>
                </div>
                <div class="mt-1.5 text-xs leading-relaxed" style="color: rgba(255,255,255,0.72);">
                  {map.sourceFilename}
                </div>
                {#if showForfeitExtras}
                  <label class="mt-2 block text-xs" style="color: rgba(255,255,255,0.75);">
                    <span class="mb-1 block font-semibold" style="color: var(--text);"
                      >Map disclaimer (optional)</span
                    >
                    <textarea
                      class="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                      style="border-color: rgba(255,255,255,0.45); background: rgba(0,0,0,0.2); color: var(--text);"
                      rows="2"
                      placeholder="Shown on the public match page for this map"
                      value={mapNoteByOrder[String(index + 1)] ?? ''}
                      oninput={(e) => {
                        mapNoteByOrder = {
                          ...mapNoteByOrder,
                          [String(index + 1)]: e.currentTarget.value,
                        }
                      }}
                    ></textarea>
                  </label>
                {/if}
              </div>
            {/each}
          </div>
        {:else if importMode === 'series_csv'}
          <div class="text-sm leading-relaxed" style="color: rgba(255,255,255,0.78);">
            No series parsed yet.
          </div>
        {/if}
      </section>
    </div>
  </div>
</PageContainer>
