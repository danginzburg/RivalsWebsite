<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import AdminEditLink from '$lib/components/AdminEditLink.svelte'
  import CommentThread from '$lib/components/CommentThread.svelte'
  import ReviewFlagButton from '$lib/components/ReviewFlagButton.svelte'
  import MatchPerformance from '$lib/components/MatchPerformance.svelte'
  import MatchReassignPanel from '$lib/components/MatchReassignPanel.svelte'
  import MatchSubPanel from '$lib/components/MatchSubPanel.svelte'
  import MatchReportPanel from '$lib/components/MatchReportPanel.svelte'
  import TeamSeed from '$lib/components/TeamSeed.svelte'
  import { ChevronRight, RadioTower, Video, AlertTriangle } from 'lucide-svelte'
  import { resolve } from '$app/paths'
  import { displayPlayerName } from '$lib/stats/ui'
  import { agentIconUrl } from '$lib/icons'

  let { data }: PageProps = $props()

  const match = $derived(data.match)
  const isAdmin = $derived(data.viewer?.isAdmin ?? false)
  const hasRealStats = $derived(data.match?.has_real_stats ?? false)

  // Distinct source accounts across all maps, for the admin reassignment panel.
  const reassignRoster = $derived.by(() => {
    const seen = new Set<string>()
    const out: Array<{
      puuid: string | null
      playerName: string
      profileId: string | null
      profileName: string | null
      isSub: boolean
    }> = []
    for (const map of (match?.maps ?? []) as Array<{ stats?: any[] }>) {
      for (const row of map.stats ?? []) {
        const puuid = (row.puuid as string | null) ?? null
        const playerName = String(row.player_name ?? '')
        const key = puuid ?? playerName
        if (!key || seen.has(key)) continue
        seen.add(key)
        out.push({
          puuid,
          playerName,
          profileId: (row.profile_id as string | null) ?? null,
          profileName: (row.profile_name as string | null) ?? null,
          isSub: Boolean(row.is_sub),
        })
      }
    }
    return out
  })

  // Forced overrides, keyed the same way the panel keys players (puuid ?? name).
  const subOverrideByKey = $derived.by(() => {
    const map = new Map<string, boolean>()
    for (const o of (match?.sub_overrides ?? []) as Array<{
      puuid: string | null
      player_name: string | null
      is_sub: boolean
    }>) {
      map.set(o.puuid ?? String(o.player_name ?? ''), o.is_sub)
    }
    return map
  })
  let activeStatsTab = $state<'total' | string>('total')

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }

  function teamLogo(value: unknown) {
    if (!value) return null
    if (Array.isArray(value))
      return (value[0] as { logo_url?: string } | undefined)?.logo_url ?? null
    return (value as { logo_url?: string }).logo_url ?? null
  }

  function teamId(value: unknown): string | null {
    if (!value) return null
    const team = (Array.isArray(value) ? value[0] : value) as { id?: string } | undefined
    return team?.id ?? null
  }

  /** Standings position for a team, from its season's leaderboard. */
  const seeds = $derived((data.seeds ?? {}) as Record<string, number>)

  function teamSeed(value: unknown): number | null {
    const id = teamId(value)
    return id ? (seeds[id] ?? null) : null
  }

  /** Scoreboard date line, e.g. "Sun, Aug 9, 2026, 8:00 PM CDT". */
  function formatWhen(value: string | null | undefined) {
    if (!value) return 'Date TBD'
    return new Date(value).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  }

  function formatTime(value: string) {
    return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }

  function formatStatus(status: string | null | undefined) {
    if (!status) return 'Unknown'
    return status.charAt(0).toUpperCase() + status.slice(1)
  }

  /** Bare host for a watch link — the full URL is noise in the list. */
  function hostName(url: string | null | undefined) {
    if (!url) return ''
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return url
    }
  }

  const isComplete = $derived(match.status === 'completed')

  /**
   * Which side the series is credited to. A forfeit can hand the series to the
   * team that lost on map score, so the stored winner outranks the scoreline.
   */
  const winnerId = $derived(
    match.winner_team_id ??
      (isComplete && match.team_a_score !== match.team_b_score
        ? match.team_a_score > match.team_b_score
          ? match.team_a_id
          : match.team_b_id
        : null)
  )

  function playerLabel(row: { profile_name?: string | null; player_name?: string | null }) {
    // Tag stripped for display only — `playerHref` still uses the stored name.
    return displayPlayerName(row.profile_name ?? row.player_name)
  }

  function playerHref(row: { profile_id?: string | null; player_name?: string | null }) {
    if (row.profile_id) return resolve(`/players/${row.profile_id}`)
    return `${resolve('/players/unclaimed')}?name=${encodeURIComponent(row.player_name ?? '')}`
  }

  function fmt(value: unknown, digits = 0) {
    if (value === null || value === undefined) return 'N/A'
    const num = Number(value)
    return Number.isFinite(num) ? num.toFixed(digits) : 'N/A'
  }

  function pct(value: unknown) {
    return value != null ? `${fmt(value, 0)}%` : 'N/A'
  }

  function sortByKillsDesc<
    T extends {
      kills?: unknown
      acs?: unknown
      profile_name?: string | null
      player_name?: string | null
    },
  >(rows: T[]): T[] {
    return [...rows].sort((a, b) => {
      const ak = Number(a.kills ?? 0)
      const bk = Number(b.kills ?? 0)
      const killsA = Number.isFinite(ak) ? ak : 0
      const killsB = Number.isFinite(bk) ? bk : 0
      if (killsB !== killsA) return killsB - killsA

      const aAcs = Number(a.acs ?? 0)
      const bAcs = Number(b.acs ?? 0)
      const acsA = Number.isFinite(aAcs) ? aAcs : 0
      const acsB = Number.isFinite(bAcs) ? bAcs : 0
      if (acsB !== acsA) return acsB - acsA

      return playerLabel(a).localeCompare(playerLabel(b), undefined, { sensitivity: 'base' })
    })
  }

  function parseAgents(value: unknown): string[] {
    if (typeof value !== 'string') return []
    return Array.from(
      new Set(
        value
          .split(/\s+/)
          .map((token) => token.trim())
          .filter(Boolean)
      )
    )
  }

  const statsTabs = $derived([
    ...(match.maps ?? []).map((map) => ({
      key: map.id,
      label: map.map_label,
      subLabel: map.map_name ?? null,
      image: map.map_image ?? null,
      team_a_rounds: map.team_a_rounds,
      team_b_rounds: map.team_b_rounds,
      rows: map.stats ?? [],
      isTotal: false,
      forfeit:
        map.forfeit && typeof map.forfeit === 'object'
          ? (map.forfeit as {
              forfeiting_team_id?: string
              label?: string
              forfeiting_team_name?: string | null
            })
          : null,
      isVoided: map.is_voided ?? false,
    })),
    {
      key: 'total',
      label: 'Series Total',
      subLabel: null,
      image: null,
      team_a_rounds: null,
      team_b_rounds: null,
      rows: match.total_stats ?? [],
      isTotal: true,
      forfeit: null,
      isVoided: false,
    },
  ])

  $effect(() => {
    const keys = statsTabs.map((tab) => tab.key)
    if (!keys.includes(activeStatsTab)) {
      activeStatsTab = 'total'
    }
  })

  const activeStats = $derived(
    statsTabs.find((tab) => tab.key === activeStatsTab) ?? statsTabs.at(-1) ?? null
  )

  type StripSegment = {
    key: string
    label: string
    name: string
    score: string
    art: string | null
    winnerLogo: string | null
    winnerName: string
    voided: boolean
    unplayed: boolean
    clickable: boolean
  }

  /**
   * The scoreboard's map strip. Played maps come first (they double as the
   * stats scope picker once stats exist), then any vetoed picks the series
   * never reached, then Series Total.
   */
  const mapStrip = $derived.by((): StripSegment[] => {
    const played = statsTabs.filter((tab) => !tab.isTotal)
    const out: StripSegment[] = played.map((tab) => {
      const a = Number(tab.team_a_rounds ?? 0)
      const b = Number(tab.team_b_rounds ?? 0)
      const winner = tab.isVoided || a === b ? null : a > b ? match.team_a : match.team_b
      const forfeited = tab.isVoided || Boolean(tab.forfeit?.forfeiting_team_id)
      return {
        key: String(tab.key),
        label: tab.label,
        // A forfeited map usually has no map name; say what happened instead.
        name: tab.subLabel ?? (forfeited ? 'Map Forfeit' : 'Unknown map'),
        score: `${a} – ${b}`,
        art: tab.image,
        winnerLogo: winner ? teamLogo(winner) : null,
        winnerName: winner ? teamName(winner) : '',
        // The FF pill and strike-through only make sense next to a real map name.
        voided: tab.isVoided && Boolean(tab.subLabel),
        unplayed: false,
        clickable: hasRealStats,
      }
    })

    // Plain array: a mutable Set inside a derived trips svelte/prefer-svelte-reactivity.
    const seenNames: string[] = played
      .map((tab) => (tab.subLabel ?? '').toLowerCase())
      .filter(Boolean)
    for (const step of match.map_vetoes ?? []) {
      if (step.action !== 'pick' && step.action !== 'decider') continue
      if (!step.mapName || seenNames.includes(step.mapName.toLowerCase())) continue
      seenNames.push(step.mapName.toLowerCase())
      out.push({
        key: `unplayed-${step.mapName}`,
        label: `Map ${out.length + 1}`,
        name: step.mapName,
        score: isComplete ? 'Not played' : 'Upcoming',
        art: step.image,
        winnerLogo: null,
        winnerName: '',
        voided: false,
        unplayed: true,
        clickable: false,
      })
    }

    if (hasRealStats && played.length > 0) {
      const counted = played.filter((tab) => !tab.isVoided)
      const roundsA = counted.reduce((s, tab) => s + Number(tab.team_a_rounds ?? 0), 0)
      const roundsB = counted.reduce((s, tab) => s + Number(tab.team_b_rounds ?? 0), 0)
      out.push({
        key: 'total',
        label: 'Series',
        name: 'Total',
        score: `${roundsA} – ${roundsB} rounds`,
        art: null,
        winnerLogo: null,
        winnerName: '',
        voided: false,
        unplayed: false,
        clickable: true,
      })
    }
    return out
  })

  const teamAStats = $derived(
    sortByKillsDesc((activeStats?.rows ?? []).filter((row) => row.team_id === match.team_a_id))
  )
  const teamBStats = $derived(
    sortByKillsDesc((activeStats?.rows ?? []).filter((row) => row.team_id === match.team_b_id))
  )
</script>

<svelte:head><title>{teamName(match.team_a)} vs {teamName(match.team_b)}</title></svelte:head>

{#snippet teamSide(team: unknown, side: 'a' | 'b')}
  {@const id = teamId(team)}
  <!-- eslint-disable svelte/no-navigation-without-resolve -->
  <!-- Both branches are resolve() calls; the rule cannot see through the ternary -->
  <a
    href={id ? resolve(`/teams/${id}`) : resolve('/')}
    class="sb-team"
    class:sb-team-b={side === 'b'}
    class:sb-loser={winnerId != null && id !== winnerId}
  >
    {#if teamLogo(team)}
      <img src={teamLogo(team)} alt="{teamName(team)} logo" class="sb-logo" />
    {:else}
      <span class="sb-logo sb-logo-empty"></span>
    {/if}
    <span class="sb-name-block">
      <span class="sb-name">{teamName(team)}</span>
      <TeamSeed seed={teamSeed(team)} label="Leaderboard rank" />
    </span>
  </a>
  <!-- eslint-enable svelte/no-navigation-without-resolve -->
{/snippet}

{#snippet segContent(seg: StripSegment)}
  {#if seg.art}
    <img class="seg-art" src={seg.art} alt="" loading="lazy" />
  {/if}
  <span class="seg-label">{seg.label}</span>
  <span class="seg-name">
    {seg.name}
    {#if seg.winnerLogo}
      <img
        class="seg-win"
        src={seg.winnerLogo}
        alt="Won by {seg.winnerName}"
        title="Won by {seg.winnerName}"
      />
    {/if}
    {#if seg.voided}<span class="seg-ff">FF</span>{/if}
  </span>
  <span class="seg-score">{seg.score}</span>
{/snippet}

{#snippet statTable(team: unknown, side: 'a' | 'b', rows: typeof teamAStats)}
  {@const label = teamName(team)}
  {@const id = teamId(team)}
  <div class="stat-block">
    <div class="team-bar" class:team-bar-a={side === 'a'} class:team-bar-b={side === 'b'}>
      {#if teamLogo(team)}<img src={teamLogo(team)} alt="" />{/if}
      <span class="team-bar-name">{label}</span>
      {#if isComplete && winnerId && activeStats?.isTotal}
        <span class="team-result" class:team-result-win={id === winnerId}>
          {id === winnerId ? 'Won' : 'Lost'}
          {side === 'a'
            ? `${match.team_a_score}–${match.team_b_score}`
            : `${match.team_b_score}–${match.team_a_score}`}
        </span>
      {/if}
    </div>
    <div class="table-scroll">
      <table class="stat-table">
        <thead>
          <tr>
            <th class="col-player">Player</th>
            <th class="col-agent">Agent</th>
            <th>ACS</th>
            <th>K</th>
            <th>D</th>
            <th>A</th>
            <th>KD</th>
            <th>ADR</th>
            <th>KAST</th>
            <th>HS%</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row, i (row.profile_id ?? `anon-${label}-${i}`)}
            <tr>
              <td class="col-player">
                <!-- eslint-disable svelte/no-navigation-without-resolve -->
                <!-- playerHref() returns a resolve()-built URL (may include a query string) -->
                <a href={playerHref(row)} class="player-link">{playerLabel(row)}</a>
                <!-- eslint-enable svelte/no-navigation-without-resolve -->
                {#if row.is_sub}
                  <span class="sub-badge" title="Played as a substitute — not on this team's roster"
                    >SUB</span
                  >
                {/if}
              </td>
              <td class="col-agent">
                <span class="agents">
                  {#each parseAgents(row.agents) as agent (agent)}
                    {#if agentIconUrl(agent)}
                      <img src={agentIconUrl(agent)} alt={agent} title={agent} class="agent-icon" />
                    {:else}
                      <span class="agent-text">{agent}</span>
                    {/if}
                  {/each}
                </span>
              </td>
              <td class="num num-strong">{fmt(row.acs, 0)}</td>
              <td class="num">{fmt(row.kills, 0)}</td>
              <td class="num">{fmt(row.deaths, 0)}</td>
              <td class="num">{fmt(row.assists, 0)}</td>
              <td class="num">{fmt(row.kd, 2)}</td>
              <td class="num">{fmt(row.adr, 0)}</td>
              <td class="num">{pct(row.kast_pct)}</td>
              <td class="num">{pct(row.hs_pct)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/snippet}

<PageContainer>
  <div class="match-page">
    <article class="sheet">
      <!-- Header: scoreboard, map strip, veto and any forfeit ruling -->
      <header class="sb">
        <div class="sb-top">
          {#if match.designation}
            <span class="sb-designation">{match.designation}</span>
          {/if}
          {#if !isComplete}
            <span
              class="sb-status"
              class:sb-status-live={match.status === 'live'}
              class:sb-status-cancelled={match.status === 'cancelled'}
            >
              {formatStatus(match.status)}
            </span>
          {/if}
          {#if match.missing_stage}
            <span
              class="sb-no-stage"
              title="Not assigned to a stage, so stage-filtered stat batches leave it out"
            >
              No stage
            </span>
          {/if}

          <div class="sb-actions">
            {#each match.streams ?? [] as stream (stream.stream_url)}
              <!-- eslint-disable svelte/no-navigation-without-resolve -->
              <!-- stream_url is an external URL; resolve() only accepts internal paths -->
              <a
                href={stream.stream_url}
                target="_blank"
                rel="noopener noreferrer"
                class="watch-btn"
                title={stream.stream_url}
              >
                <RadioTower size={15} class="watch-icon" />
                <span class="watch-name">{stream.metadata?.display_name || stream.platform}</span>
                <span class="watch-meta">
                  {hostName(stream.stream_url)}{stream.status ? ` · ${stream.status}` : ''}
                </span>
              </a>
              <!-- eslint-enable svelte/no-navigation-without-resolve -->
            {/each}
            {#if match.vod_url}
              <!-- eslint-disable svelte/no-navigation-without-resolve -->
              <!-- vod_url is an external URL; resolve() only accepts internal paths -->
              <a
                href={match.vod_url}
                target="_blank"
                rel="noopener noreferrer"
                class="watch-btn"
                title={match.vod_url}
              >
                <Video size={15} class="watch-icon" />
                <span class="watch-name">VOD</span>
                <span class="watch-meta">{hostName(match.vod_url)}</span>
              </a>
              <!-- eslint-enable svelte/no-navigation-without-resolve -->
            {/if}
            {#if isAdmin}
              <AdminEditLink
                href="/admin?tab=matches&match={match.id}"
                label="Edit Match"
                class="sb-admin"
              />
            {/if}
          </div>
        </div>

        <div class="sb-row">
          {@render teamSide(match.team_a, 'a')}

          <div class="sb-center">
            {#if isComplete}
              <div class="sb-score">
                <span class="sb-num" class:sb-num-win={match.team_a_id === winnerId}>
                  {match.team_a_score}
                </span>
                <span class="sb-dash">–</span>
                <span class="sb-num" class:sb-num-win={match.team_b_id === winnerId}>
                  {match.team_b_score}
                </span>
              </div>
            {:else}
              <div class="sb-vs">vs</div>
            {/if}
            <div class="sb-format">BO{match.best_of}{isComplete ? ' · Final' : ''}</div>
          </div>

          {@render teamSide(match.team_b, 'b')}
        </div>

        <p class="sb-when">
          {formatWhen(match.scheduled_at)}
          {#if match.started_at}
            <span class="sb-when-sep">·</span> Started {formatTime(match.started_at)}
          {/if}
        </p>

        <!-- Map strip: each map's result, and the stats scope picker once stats exist -->
        {#if mapStrip.length > 0}
          <nav class="map-strip" aria-label="Maps">
            {#each mapStrip as seg (seg.key)}
              {#if seg.clickable}
                <button
                  type="button"
                  class="seg"
                  class:seg-on={activeStatsTab === seg.key}
                  class:seg-void={seg.voided}
                  aria-pressed={activeStatsTab === seg.key}
                  onclick={() => (activeStatsTab = seg.key)}
                >
                  {@render segContent(seg)}
                </button>
              {:else}
                <div class="seg" class:seg-off={seg.unplayed} class:seg-void={seg.voided}>
                  {@render segContent(seg)}
                </div>
              {/if}
            {/each}
          </nav>
        {/if}

        {#if (match.map_vetoes?.length ?? 0) > 0}
          <div class="veto">
            <span class="veto-title">Veto</span>
            <ol class="veto-list">
              {#each match.map_vetoes as step, index (index)}
                <li
                  class="veto-step"
                  class:veto-ban={step.action === 'ban'}
                  class:veto-pick={step.action === 'pick'}
                  class:veto-decider={step.action === 'decider'}
                  title={step.text}
                >
                  {#if step.image}
                    <img class="veto-img" src={step.image} alt="" loading="lazy" />
                  {/if}
                  <span class="veto-caption">
                    <span class="veto-map">{step.mapName ?? step.text}</span>
                    {#if step.label}
                      <span class="veto-action">{step.label}</span>
                    {:else if step.action}
                      <span class="veto-action">{step.action}</span>
                    {/if}
                  </span>
                </li>
              {/each}
            </ol>
          </div>
        {/if}

        {#if match.forfeit_display}
          <div class="notice">
            <AlertTriangle size={16} />
            <div>
              {#if match.forfeit_display.kind === 'admin_award'}
                <p class="notice-title">Series result (forfeit)</p>
                <p class="notice-body">
                  Official winner: <b>{match.forfeit_display.winnerTeamName ?? '—'}</b>. Map scores
                  ({match.team_a_score}-{match.team_b_score}) reflect play on the server.
                  {#if match.forfeit_display.forfeitingTeamName}
                    Forfeiting side: {match.forfeit_display.forfeitingTeamName}.
                  {/if}
                </p>
                {#if match.forfeit_display.reason}
                  <p class="notice-sub">{match.forfeit_display.reason}</p>
                {/if}
              {:else if match.forfeit_display.kind === 'no_show'}
                <p class="notice-title">No-show forfeit</p>
                <p class="notice-body">
                  Winner: <b>{match.forfeit_display.winnerTeamName ?? '—'}</b>.
                  {#if match.forfeit_display.forfeitingTeamName}
                    Opponent did not field a team in time: {match.forfeit_display
                      .forfeitingTeamName}.
                  {/if}
                </p>
              {/if}
            </div>
          </div>
        {/if}
      </header>

      <!-- Captains of either team paste the veto and tracker links here once
           the match has been played. -->
      {#if data.report && match.team_a && match.team_b}
        <MatchReportPanel
          matchId={match.id}
          teamA={{ id: String(match.team_a.id), name: teamName(match.team_a) }}
          teamB={{ id: String(match.team_b.id), name: teamName(match.team_b) }}
          hasStats={hasRealStats}
          report={data.report}
        />
      {/if}

      <!-- Stats: only shown once a real import exists. Before that there is
           nothing to show but a guessed lineup, which isn't worth a section. -->
      {#if hasRealStats && activeStats}
        <section class="sheet-section">
          <div class="sheet-head">
            <h2 class="sheet-title">Match Stats</h2>
            <div class="stats-flag">
              <ReviewFlagButton
                entityType="match"
                entityId={match.id}
                viewerId={data.viewer?.profileId ?? null}
                noun="match"
              />
            </div>
          </div>

          <div class="sheet-body">
            {#if !activeStats.isTotal && activeStats.forfeit?.forfeiting_team_id}
              <div class="notice notice-inline">
                <AlertTriangle size={15} />
                <div>
                  <p class="notice-title">Forfeit note (this map)</p>
                  {#if activeStats.forfeit.forfeiting_team_name}
                    <p class="notice-body">
                      {activeStats.forfeit.forfeiting_team_name} forfeited this map in the context of
                      the series ruling.
                    </p>
                  {/if}
                  {#if activeStats.forfeit.label}
                    <p class="notice-sub">{activeStats.forfeit.label}</p>
                  {/if}
                </div>
              </div>
            {/if}

            <div class="sheet-pair">
              {@render statTable(match.team_a, 'a', teamAStats)}
              {@render statTable(match.team_b, 'b', teamBStats)}
            </div>
          </div>
        </section>

        <!-- Follows the same map/total scope as the stats above, so the two
             never disagree about which map is being looked at. -->
        <MatchPerformance
          rows={(activeStats?.rows ?? []) as never}
          teamAId={match.team_a_id}
          teamAName={teamName(match.team_a)}
          teamBName={teamName(match.team_b)}
          teamALogo={teamLogo(match.team_a)}
          teamBLogo={teamLogo(match.team_b)}
        />
      {/if}

      <CommentThread
        entityType="match"
        entityId={match.id}
        comments={data.comments ?? []}
        viewerId={data.viewer?.profileId ?? null}
        isAdmin={data.viewer?.isAdmin ?? false}
        variant="flush"
      />

      {#if isAdmin && hasRealStats && reassignRoster.length > 0}
        <details class="sheet-section admin-tools">
          <summary class="admin-tools-summary">
            <ChevronRight size={14} class="admin-tools-chevron" />
            <span class="admin-tools-title">Admin tools</span>
            <span class="admin-tools-note">Reassign stat rows · Sub overrides</span>
          </summary>
          <div class="sheet-body">
            <MatchReassignPanel matchId={match.id} players={reassignRoster} />
            <MatchSubPanel
              matchId={match.id}
              players={reassignRoster}
              overrideByKey={subOverrideByKey}
            />
          </div>
        </details>
      {/if}
    </article>
  </div>
</PageContainer>

<style src="./page.css"></style>
