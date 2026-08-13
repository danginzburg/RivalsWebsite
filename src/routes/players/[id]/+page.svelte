<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import CommentThread from '$lib/components/CommentThread.svelte'
  import { User, ExternalLink } from 'lucide-svelte'
  import DiscordIcon from '$lib/components/icons/DiscordIcon.svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import { resolve } from '$app/paths'
  import miksIcon from '$lib/assets/agents/Miks_icon.webp'
  import { builtInAccoladeIcons } from '$lib/accolades/icons'
  import { enhance } from '$app/forms'
  import { rankImageKey } from '$lib/ranks/ranks'

  let { data, form }: PageProps = $props()

  const player = $derived(data.player)
  const activeTeam = $derived(data.activeTeam)
  const viewer = $derived(data.viewer ?? { canEditRiotIdBase: false })
  const selected = $derived((data.stats?.selected ?? null) as any | null)
  const selectedBatchId = $derived((data.stats?.selectedBatchId ?? null) as string | null)
  const allBatchOptions = $derived(
    (data.stats?.batchOptions ?? []) as Array<{
      label: string
      value: string
      import_kind?: string | null
      week_label?: string | null
    }>
  )
  let hideWeeks = $state(false)
  function isWeekBatch(b: {
    import_kind?: string | null
    week_label?: string | null
    label?: string | null
  }) {
    if (b.import_kind === 'weekly') return true
    if (b.week_label) return true
    if (typeof b.label === 'string' && /week/i.test(b.label)) return true
    return false
  }
  const hasAnyWeeks = $derived(allBatchOptions.some((b) => isWeekBatch(b)))
  const batchOptions = $derived(
    hideWeeks ? allBatchOptions.filter((b) => !isWeekBatch(b)) : allBatchOptions
  )
  const matchHistory = $derived((data.matchHistory ?? []) as any[])
  const teamHistory = $derived(data.teamHistory ?? [])
  const mapStats = $derived(
    (data.mapStats ?? []) as Array<{
      key: string
      maps_played: number
      maps_won: number
      maps_decided: number
      rounds: number
      acs: number | null
      kills: number
      deaths: number
      assists: number
      kd: number | null
      adr: number | null
      kast_pct: number | null
      hs_pct: number | null
      fk: number
      fd: number
      win_pct: number | null
    }>
  )
  const agentStats = $derived(
    (data.agentStats ?? []) as Array<{
      key: string
      maps_played: number
      maps_won: number
      maps_decided: number
      rounds: number
      acs: number | null
      kills: number
      deaths: number
      assists: number
      kd: number | null
      adr: number | null
      kast_pct: number | null
      hs_pct: number | null
      fk: number
      fd: number
      win_pct: number | null
    }>
  )
  const accolades = $derived(
    (data.accolades ?? []) as Array<{
      id: string
      name: string
      icon_key: string | null
      context: string | null
      logo_url: string | null
    }>
  )

  let riotIdBaseValue = $state('')
  let statsPlayerNameValue = $state('')
  $effect(() => {
    riotIdBaseValue = player.riot_id_base ?? ''
    statsPlayerNameValue = player.stats_player_name ?? ''
  })

  const agentAssetModules = import.meta.glob('$lib/assets/agents/*_icon.webp', {
    eager: true,
    import: 'default',
  }) as Record<string, string>

  const agentIconMap = $derived.by(() => {
    const map = new SvelteMap<string, string>()
    const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')
    for (const [path, url] of Object.entries(agentAssetModules)) {
      const filename = path.split('/').pop() ?? ''
      const base = filename.replace(/_icon\.webp$/i, '')
      map.set(normalize(base), url)
    }
    if (map.has('harbor')) map.set('harbour', map.get('harbor')!)
    map.set('miks', miksIcon)
    return map
  })

  function agentIconUrl(agentName: string): string | null {
    const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')
    return agentIconMap.get(normalize(agentName)) ?? null
  }

  const rankAssetModules = import.meta.glob('$lib/assets/ranks/*_Rank.png', {
    eager: true,
    import: 'default',
  }) as Record<string, string>

  const rankIconMap = $derived.by(() => {
    const map = new SvelteMap<string, string>()
    for (const [path, url] of Object.entries(rankAssetModules)) {
      const filename = path.split('/').pop() ?? ''
      const key = filename.replace(/\.png$/i, '')
      map.set(key, url)
    }
    return map
  })

  function rankIconUrl(leagueRank: unknown): string | null {
    if (typeof leagueRank !== 'string') return null
    const key = rankImageKey(leagueRank)
    return key ? (rankIconMap.get(key) ?? null) : null
  }

  const playerRank = $derived((data.bestRank ?? null) as string | null)

  function parseAgents(value: unknown): string[] {
    if (typeof value !== 'string') return []
    const tokens = value
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
    return Array.from(new Set(tokens))
  }

  function fmt(n: unknown, digits = 1) {
    const v = Number(n)
    if (!Number.isFinite(v)) return '—'
    return v.toFixed(digits)
  }

  function navToBatch(batchId: string) {
    window.location.href = `/players/${player.profile_id}?batchId=${encodeURIComponent(batchId)}`
  }

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }

  const selectedBatchLabel = $derived.by(() => {
    if (!selected) return null
    const parts = [selected.batch?.display_name ?? selected.import_batch_id]
    if (selected.batch?.import_kind === 'weekly' && selected.batch?.week_label) {
      parts.push(selected.batch.week_label)
    }
    return parts.filter(Boolean).join(' · ')
  })
</script>

<svelte:head><title>{player.riot_id}</title></svelte:head>

{#snippet breakdownTable(heading: string, label: string, rows: typeof mapStats, withIcon: boolean)}
  <section class="card">
    <header class="card-head">
      <h2 class="card-title">{heading}</h2>
      <span class="card-note-inline"
        >All recorded maps — the batch selector above does not apply.</span
      >
    </header>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th class="col-left">{label}</th>
            <th>Played</th>
            <th>Win%</th>
            <th>ACS</th>
            <th>K/D</th>
            <th>ADR</th>
            <th>KAST</th>
            <th>HS%</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as entry (entry.key)}
            <tr>
              <td class="col-left">
                <span class="entry-key">
                  {#if withIcon && agentIconUrl(entry.key)}
                    <img src={agentIconUrl(entry.key) ?? ''} alt="" class="agent-icon" />
                  {/if}
                  {entry.key}
                </span>
              </td>
              <td class="num">{entry.maps_played}</td>
              <td class="num">
                {#if entry.win_pct != null}
                  {fmt(entry.win_pct, 0)}%
                  <span
                    class="record"
                    title="Maps won–lost. Maps with no recorded result are excluded."
                  >
                    {entry.maps_won}–{entry.maps_decided - entry.maps_won}
                  </span>
                {:else}
                  —
                {/if}
              </td>
              <td class="num num-strong">{fmt(entry.acs, 0)}</td>
              <td class="num">{fmt(entry.kd, 2)}</td>
              <td class="num">{fmt(entry.adr, 0)}</td>
              <td class="num">{fmt(entry.kast_pct, 0)}%</td>
              <td class="num">{fmt(entry.hs_pct, 0)}%</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
{/snippet}

<PageContainer>
  <div class="player-page">
    <div class="min-w-0">
      <div class="hero">
        <div class="flex items-start gap-4">
          {#if activeTeam?.logo_url}
            <img src={activeTeam.logo_url} alt="{activeTeam.name} logo" class="hero-logo" />
          {:else}
            <div class="hero-logo hero-logo-empty">
              <User size={34} />
            </div>
          {/if}
          <div class="min-w-0">
            <div class="flex flex-wrap items-end gap-2">
              <h1 class="hero-name">{player.riot_id}</h1>
              {#if playerRank}
                {@const rUrl = rankIconUrl(playerRank)}
                {#if rUrl}
                  <img
                    src={rUrl}
                    alt={playerRank}
                    title={playerRank}
                    class="h-8 w-8 object-contain sm:h-10 sm:w-10"
                  />
                {/if}
              {/if}
              {#each accolades as accolade, i (accolade.id + '-' + i)}
                {@const iconSrc = accolade.icon_key
                  ? (builtInAccoladeIcons[accolade.icon_key] ?? null)
                  : null}
                {@const tooltip = accolade.context
                  ? `${accolade.name} — ${accolade.context}`
                  : accolade.name}
                {#if iconSrc || accolade.logo_url}
                  <img
                    src={iconSrc ?? accolade.logo_url}
                    alt={accolade.name}
                    title={tooltip}
                    class="accolade-icon h-5 w-5 rounded object-contain sm:h-7 sm:w-7 md:h-9 md:w-9"
                  />
                {:else}
                  <span
                    class="accolade-icon inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold sm:text-xs"
                    style="border-color: rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8);"
                    title={tooltip}
                  >
                    {accolade.name}
                  </span>
                {/if}
              {/each}
            </div>
            <!-- Team identity and contact links share one line; contacts are
                 published only once a signup is approved. -->
            <div class="identity-row">
              {#if activeTeam}
                <a
                  href={resolve(`/teams/${activeTeam.id}`)}
                  class="identity-team inline-flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-white/5"
                  style="color: var(--text);"
                >
                  <span class="font-medium" style="color: rgba(255,255,255,0.88);"
                    >{activeTeam.name}</span
                  >
                  {#if activeTeam.tag}
                    <span class="text-sm" style="color: rgba(255,255,255,0.62);"
                      >[{String(activeTeam.tag).toUpperCase()}]</span
                    >
                  {/if}
                  {#if activeTeam.role}
                    <span
                      class="identity-role text-sm capitalize"
                      style="color: rgba(255,255,255,0.52);">{activeTeam.role}</span
                    >
                  {/if}
                </a>
              {:else}
                <span class="text-sm" style="color: rgba(255,255,255,0.72);">No active team</span>
              {/if}

              {#if player.discord_handle || (player.tracker_links ?? []).length > 0}
                <span class="identity-divider"></span>
              {/if}

              {#if player.discord_handle}
                <span class="contact-chip" title="Discord">
                  <DiscordIcon size={13} />
                  {player.discord_handle}
                </span>
              {/if}
              {#each player.tracker_links ?? [] as link (link.url)}
                <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="contact-chip contact-chip-link"
                >
                  <ExternalLink size={12} />
                  {link.label}
                </a>
              {/each}
            </div>
          </div>
        </div>
      </div>

      <section class="card">
        <div class="card-body">
          {#if viewer.canEditRiotIdBase && !player.riot_id_base}
            <div
              class="mb-4 rounded-md border p-3"
              style="border-color: rgba(59,130,246,0.25); background: rgba(59,130,246,0.10);"
            >
              <div class="mb-1 text-sm font-semibold" style="color: rgba(255,255,255,0.92);">
                Link Your Stats
              </div>
              <div class="text-xs" style="color: rgba(255,255,255,0.72);">
                Enter your Riot name (base only, no #tag). Admin stat imports match on this.
              </div>

              <form class="mt-3 flex flex-col gap-2 md:flex-row" method="POST" use:enhance>
                <input
                  name="riot_id_base"
                  bind:value={riotIdBaseValue}
                  class="w-full flex-1 rounded-md border px-3 py-2 text-sm"
                  style="border-color: rgba(255,255,255,0.45); background: rgba(0,0,0,0.25); color: var(--text);"
                  placeholder="Example: Ginzburg"
                  autocomplete="off"
                />
                <button
                  type="submit"
                  formaction="?/setRiotIdBase"
                  class="rounded-md px-3 py-2 text-sm font-semibold"
                  style="background: rgba(74,222,128,0.2); color: #4ade80;"
                >
                  Save
                </button>
              </form>

              {#if form?.success === false}
                <div
                  class="mt-2 rounded-md border p-2 text-sm"
                  style="border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); color: #fecaca;"
                >
                  {form.message ?? 'Failed to save'}
                </div>
              {/if}
            </div>
          {/if}

          {#if viewer.canEditRiotIdBase && player.has_unmatched_stats_candidate}
            <div
              class="mb-4 rounded-md border p-3"
              style="border-color: rgba(168,85,247,0.25); background: rgba(168,85,247,0.10);"
            >
              <div class="mb-1 text-sm font-semibold" style="color: rgba(255,255,255,0.92);">
                Alternate Stats Name
              </div>
              <div class="text-xs" style="color: rgba(255,255,255,0.72);">
                Use this when imported stats still list an old Riot or display name. This will also
                try to relink past imported stats.
              </div>

              <form class="mt-3 flex flex-col gap-2 md:flex-row" method="POST" use:enhance>
                <input
                  name="stats_player_name"
                  bind:value={statsPlayerNameValue}
                  class="w-full flex-1 rounded-md border px-3 py-2 text-sm"
                  style="border-color: rgba(255,255,255,0.45); background: rgba(0,0,0,0.25); color: var(--text);"
                  placeholder="Example: OldName"
                  autocomplete="off"
                />
                <button
                  type="submit"
                  formaction="?/setStatsPlayerName"
                  class="rounded-md px-3 py-2 text-sm font-semibold"
                  style="background: rgba(168,85,247,0.2); color: #d8b4fe;"
                >
                  Save Alt Name
                </button>
              </form>
            </div>
          {/if}

          <div class="stats-bar">
            <span class="section-label">Stats</span>
            {#if selectedBatchLabel}
              <span class="stats-batch">{selectedBatchLabel}</span>
            {/if}
            <div class="stats-controls">
              {#if hasAnyWeeks}
                <button
                  type="button"
                  class="toggle-btn"
                  class:toggle-btn-on={hideWeeks}
                  onclick={() => (hideWeeks = !hideWeeks)}
                >
                  Hide Weeks
                </button>
              {/if}
              {#if batchOptions.length > 0}
                <div class="batch-select">
                  <CustomSelect
                    options={batchOptions}
                    value={selectedBatchId ?? ''}
                    compact={true}
                    onSelect={navToBatch}
                  />
                </div>
              {/if}
            </div>
          </div>

          {#if !selected}
            <p class="muted">No imported stats found for this player.</p>
          {:else}
            <div class="kpi-row">
              <div class="kpi">
                <span class="kpi-label">Games</span>
                <span class="kpi-value">{selected.games ?? '—'}</span>
              </div>
              <div class="kpi">
                <span class="kpi-label">ACS</span>
                <span class="kpi-value">{fmt(selected.acs, 0)}</span>
              </div>
              <div class="kpi">
                <span class="kpi-label">K/D</span>
                <span class="kpi-value">{fmt(selected.kd, 2)}</span>
              </div>
              <div class="kpi">
                <span class="kpi-label">ADR</span>
                <span class="kpi-value">{fmt(selected.adr, 0)}</span>
              </div>
              <div class="kpi">
                <span class="kpi-label">HS%</span>
                <span class="kpi-value">{fmt(selected.hs_pct, 0)}</span>
              </div>
            </div>

            {#if parseAgents(selected.agents).length > 0}
              <div class="agent-pool">
                <span class="section-label">Agents</span>
                <div class="agents-icons">
                  {#each parseAgents(selected.agents) as agent (agent)}
                    {@const url = agentIconUrl(agent)}
                    {#if url}
                      <img src={url} alt={agent} title={agent} class="agent-tile" />
                    {:else}
                      <span class="agent-tile agent-tile-text" title={agent}>
                        {agent.slice(0, 3).toUpperCase()}
                      </span>
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}
          {/if}
        </div>
      </section>

      {#if mapStats.length > 0}
        {@render breakdownTable('Map Stats', 'Map', mapStats, false)}
      {/if}

      {#if agentStats.length > 0}
        {@render breakdownTable('Agent Stats', 'Agent', agentStats, true)}
      {/if}

      <section class="card">
        <header class="card-head">
          <h2 class="card-title">Match History</h2>
          {#if matchHistory.length > 0}
            <span class="card-count">{matchHistory.length}</span>
          {/if}
        </header>

        {#if matchHistory.length === 0}
          <p class="card-empty">No participation stats recorded yet.</p>
        {:else}
          <div class="match-rows">
            {#each matchHistory as entry (entry.match.id)}
              {@const match = entry.match}
              {@const opp = entry.opponent}
              {@const score = entry.score}
              {@const won = score.us > score.them}
              <a href={resolve(`/matches/${match.id}`)} class="match-row">
                <span class="row-badge" class:row-win={won} class:row-loss={!won}>
                  {won ? 'W' : 'L'}
                </span>

                {#if opp?.logo_url}
                  <img src={opp.logo_url} alt="" class="row-logo" />
                {:else}
                  <span class="row-logo row-logo-empty"></span>
                {/if}

                <span class="row-name">{teamName(opp)}</span>

                <span class="row-agents">
                  {#each parseAgents(entry.agents) as agent (agent)}
                    {@const url = agentIconUrl(agent)}
                    {#if url}
                      <img src={url} alt={agent} title={agent} class="agent-icon" />
                    {:else}
                      <span class="agent-icon agent-icon-text" title={agent}>
                        {agent.slice(0, 3).toUpperCase()}
                      </span>
                    {/if}
                  {/each}
                </span>

                <span class="row-stat" title="Average combat score">
                  <b>{fmt(entry.acs, 0)}</b> ACS
                </span>
                <span class="row-stat row-kda">
                  {entry.kills ?? 0}/{entry.deaths ?? 0}/{entry.assists ?? 0}
                </span>
                <span class="row-stat row-hide-sm"><b>{fmt(entry.kast_pct, 0)}%</b> KAST</span>
                <span class="row-stat row-hide-sm"><b>{fmt(entry.hs_pct, 0)}%</b> HS</span>

                <span class="row-score">
                  <b class:score-win={won}>{score.us}</b>
                  <span class="score-sep">–</span>
                  <b class:score-win={!won}>{score.them}</b>
                </span>
              </a>
            {/each}
          </div>
        {/if}
      </section>

      <section class="card">
        <header class="card-head">
          <h2 class="card-title">Team History</h2>
          {#if teamHistory.length > 0}
            <span class="card-count">{teamHistory.length}</span>
          {/if}
        </header>

        {#if teamHistory.length === 0}
          <p class="card-empty">Not rostered on a team yet.</p>
        {:else}
          <div class="team-rows">
            {#each teamHistory as entry (entry.team.id)}
              <a href={resolve(`/teams/${entry.team.id}`)} class="team-row">
                {#if entry.team.logo_url}
                  <img src={entry.team.logo_url} alt="" class="row-logo" />
                {:else}
                  <span class="row-logo row-logo-empty"></span>
                {/if}

                <span class="team-row-name">
                  {entry.team.name}
                  {#if entry.team.tag}
                    <span class="team-row-tag">{entry.team.tag}</span>
                  {/if}
                </span>

                {#if entry.role && entry.role !== 'player'}
                  <span class="team-row-role">{entry.role}</span>
                {/if}

                <span class="team-row-season">{entry.season?.name ?? 'Unassigned season'}</span>

                <span class="team-row-status" class:team-row-current={entry.is_current}>
                  {entry.is_current ? 'Current' : 'Former'}
                </span>
              </a>
            {/each}
          </div>
        {/if}
      </section>

      <CommentThread
        entityType="player"
        entityId={player.profile_id}
        comments={data.comments ?? []}
        viewerId={data.viewer?.profileId ?? null}
        isAdmin={data.viewer?.isAdmin ?? false}
      />
    </div>
  </div>
</PageContainer>

<style>
  .player-page {
    width: 100%;
    /*
     * The widest thing here is a stat table that needs ~510px; at 80rem the
     * columns were stretched across a third more space than they had content
     * for. 64rem still clears everything without truncation.
     */
    max-width: 64rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
  }

  .player-page > div {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Identity */
  .hero {
    padding: 1.5rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.09);
    background: linear-gradient(135deg, rgba(120, 67, 145, 0.14), rgba(0, 0, 0, 0.25));
  }

  .hero-logo {
    width: 5rem;
    height: 5rem;
    border-radius: 0.625rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .hero-logo-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.5);
  }

  .hero-name {
    font-size: 1.875rem;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.015em;
    color: var(--title);
  }

  /* Cards */
  .card {
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.2);
    overflow: hidden;
  }

  .card-head {
    display: flex;
    align-items: baseline;
    gap: 0.625rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .card-title {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--title);
    flex-shrink: 0;
  }

  .card-note-inline {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.45);
  }

  .card-count {
    margin-left: auto;
    font-size: 0.6875rem;
    font-weight: 700;
    padding: 0.125rem 0.4375rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.6);
    font-variant-numeric: tabular-nums;
  }

  .card-body {
    padding: 1rem;
  }

  .card-empty {
    padding: 2rem 1rem;
    text-align: center;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .muted {
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .section-label {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.55);
  }

  /* Stats controls */
  .stats-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.625rem;
    margin-bottom: 0.875rem;
  }

  .stats-batch {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .stats-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
  }

  .batch-select {
    min-width: 16rem;
  }

  .toggle-btn {
    padding: 0.4375rem 0.75rem;
    border-radius: 0.4375rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.25);
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.15s,
      border-color 0.15s,
      color 0.15s;
  }

  .toggle-btn:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
  }

  .toggle-btn-on {
    border-color: rgba(120, 67, 145, 0.6);
    background: var(--accent);
    color: var(--text);
  }

  /* KPI tiles */
  .kpi-row {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.625rem;
  }

  .kpi {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.75rem 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(255, 255, 255, 0.02);
  }

  .kpi-label {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.5);
  }

  .kpi-value {
    font-size: 1.375rem;
    font-weight: 700;
    line-height: 1;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  .agent-pool {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 1rem;
    padding-top: 0.875rem;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }

  .agent-tile {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.3125rem;
    object-fit: contain;
    background: rgba(0, 0, 0, 0.2);
  }

  .agent-tile-text {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.14);
    font-size: 0.5625rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.75);
  }

  /* Breakdown tables */
  .table-scroll {
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .data-table th {
    padding: 0.5rem 0.75rem;
    text-align: right;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
  }

  .data-table td {
    padding: 0.5rem 0.75rem;
    color: rgba(255, 255, 255, 0.8);
    white-space: nowrap;
  }

  .data-table tbody tr {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .data-table tbody tr:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .data-table .col-left {
    text-align: left;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .num-strong {
    font-weight: 700;
    color: var(--text);
  }

  .entry-key {
    display: inline-flex;
    align-items: center;
    gap: 0.4375rem;
    font-weight: 600;
    color: var(--text);
  }

  .record {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.45);
  }

  /* Match history rows — same shape as the team page. */
  .match-rows {
    display: flex;
    flex-direction: column;
  }

  .match-row {
    display: flex;
    align-items: center;
    gap: 0.6875rem;
    padding: 0.625rem 1rem;
    text-decoration: none;
    color: var(--text);
    transition: background 0.15s;
  }

  .match-row + .match-row {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .match-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .match-row:hover .row-name {
    color: var(--accent-text);
  }

  .row-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 0.3125rem;
    font-size: 0.6875rem;
    font-weight: 800;
    flex-shrink: 0;
  }

  .row-win {
    background: rgba(74, 222, 128, 0.16);
    color: #4ade80;
  }

  .row-loss {
    background: rgba(248, 113, 113, 0.14);
    color: #f87171;
  }

  .row-logo {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.3125rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .row-logo-empty {
    background: rgba(255, 255, 255, 0.06);
  }

  .row-name {
    flex: 1;
    min-width: 6rem;
    font-size: 0.875rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s;
  }

  /* Team history — same row rhythm as the match list above it. */
  .team-rows {
    display: flex;
    flex-direction: column;
  }

  .team-row {
    display: flex;
    align-items: center;
    /*
     * Wraps rather than overflowing: logo, name, role, season and status do
     * not share one line on a phone, and the status was the item pushed off
     * the right edge.
     */
    flex-wrap: wrap;
    gap: 0.6875rem;
    padding: 0.625rem 1rem;
    text-decoration: none;
    color: var(--text);
    transition: background 0.15s;
  }

  .team-row + .team-row {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .team-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .team-row:hover .team-row-name {
    color: var(--accent-text);
  }

  .team-row-name {
    /*
     * Small basis on purpose: flex wraps before it shrinks, so a generous basis
     * would push the status onto a second line while there was still room to
     * ellipsize the name instead.
     */
    flex: 1 1 4rem;
    min-width: 0;
    font-size: 0.875rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color 0.15s;
  }

  .team-row-tag {
    margin-left: 0.375rem;
    font-size: 0.75rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.45);
  }

  .team-row-role {
    flex-shrink: 0;
    padding: 0.0625rem 0.375rem;
    border-radius: 0.25rem;
    background: rgba(255, 255, 255, 0.08);
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.7);
  }

  .team-row-season {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .team-row-status {
    flex-shrink: 0;
    /* Stays hard right whether it shares the first line or wraps below. */
    margin-left: auto;
    min-width: 3.75rem;
    text-align: right;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.4);
  }

  .team-row-current {
    color: #4ade80;
  }

  .row-agents {
    display: flex;
    gap: 0.1875rem;
    flex-shrink: 0;
  }

  .agent-icon {
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 0.25rem;
    object-fit: contain;
    background: rgba(0, 0, 0, 0.2);
  }

  .agent-icon-text {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.14);
    font-size: 0.5rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.75);
  }

  .row-stat {
    flex-shrink: 0;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.45);
    font-variant-numeric: tabular-nums;
  }

  .row-stat b {
    font-weight: 700;
    color: rgba(255, 255, 255, 0.82);
  }

  .row-kda {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.7);
  }

  .row-score {
    display: flex;
    align-items: center;
    gap: 0.3125rem;
    flex-shrink: 0;
    font-size: 0.9375rem;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.45);
  }

  .score-win {
    color: var(--text);
  }

  .score-sep {
    opacity: 0.4;
    font-size: 0.75rem;
  }

  .agents-icons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* Team identity and contact chips on one line, wrapping when narrow. */
  .identity-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.5rem;
  }

  /*
   * Team name, tag and role sit on one line until they cannot. Without this the
   * chip refuses to shrink below its content and spills past the hero on a
   * phone — "Virtuous.Proletariat [VP] player" is wider than the column.
   */
  .identity-team {
    min-width: 0;
    flex-wrap: wrap;
  }

  /* Short and centred so it separates without crowding the text above. */
  .identity-divider {
    width: 1px;
    height: 0.75rem;
    align-self: center;
    background: rgba(255, 255, 255, 0.12);
    margin: 0 0.375rem;
  }

  .contact-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    padding: 0.1875rem 0.5rem;
    border-radius: 0.3125rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.75rem;
    text-decoration: none;
  }

  .contact-chip-link:hover {
    border-color: rgba(120, 67, 145, 0.5);
    background: rgba(120, 67, 145, 0.12);
    color: #d8b4fe;
  }

  /* Responsive */
  @media (max-width: 900px) {
    .kpi-row {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .stats-controls {
      margin-left: 0;
      width: 100%;
    }

    .batch-select {
      flex: 1;
      min-width: 0;
    }

    /* KAST and HS% are the first to go when the row runs out of room. */
    .row-hide-sm {
      display: none;
    }
  }

  @media (max-width: 640px) {
    .player-page {
      padding: 1rem 0.75rem 2rem;
    }

    .hero {
      padding: 1rem;
    }

    .hero-logo {
      width: 3.5rem;
      height: 3.5rem;
    }

    .hero-name {
      font-size: 1.375rem;
    }

    .kpi-row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .kpi-value {
      font-size: 1.125rem;
    }

    .row-agents,
    .row-stat {
      display: none;
    }

    .row-kda {
      display: inline;
    }

    /*
     * The role reads as filler next to the team name, and the divider is a
     * separator for a line that no longer has room to be one line. Dropping
     * both is what lets the header and each history row stay on one line.
     */
    .identity-role,
    .identity-divider,
    .team-row-role {
      display: none;
    }
  }
</style>
