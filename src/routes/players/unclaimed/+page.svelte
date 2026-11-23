<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { BarChart3 } from 'lucide-svelte'
  import { SvelteURLSearchParams } from 'svelte/reactivity'
  import { resolve } from '$app/paths'
  import { enhance } from '$app/forms'
  import { agentIconUrl, rankIconUrlByKey } from '$lib/icons'
  import { rankImageKey, rankLabel } from '$lib/ranks/ranks'
  import ExternalEventsToggle from '$lib/components/ExternalEventsToggle.svelte'
  import { externalEvents } from '$lib/stores/external-events.svelte'

  let { data, form }: PageProps = $props()

  const clickedName = $derived(String(data.clickedName ?? 'Player'))
  const base = $derived(String(data.base ?? ''))
  const batchId = $derived(data.batchId ?? null)
  const allBatchOptions = $derived(
    (data.batchOptions ?? []) as Array<{
      label: string
      value: string
      import_kind?: string | null
      external?: boolean
    }>
  )
  // External events (Shitter League) are hidden unless shown — except when the
  // picked stats table is one.
  const viewingExternal = $derived(allBatchOptions.some((o) => o.value === batchId && o.external))
  const hideExternal = $derived(!externalEvents.show && !viewingExternal)
  const externalSeasonIds = $derived(new Set((data.externalSeasonIds ?? []) as string[]))
  const isExternalMatch = (season_id: string | null | undefined) =>
    Boolean(season_id) && externalSeasonIds.has(season_id as string)
  const batchOptions = $derived(
    hideExternal
      ? allBatchOptions.filter((o) => !o.external || o.value === batchId)
      : allBatchOptions
  )
  const selected = $derived(data.selected ?? null)
  const allMatchHistory = $derived(data.matchHistory ?? [])
  const hasExternalContent = $derived(
    allBatchOptions.some((o) => o.external) ||
      allMatchHistory.some((e) => isExternalMatch(e.match.season_id))
  )
  const matchHistory = $derived(
    hideExternal
      ? allMatchHistory.filter((e) => !isExternalMatch(e.match.season_id))
      : allMatchHistory
  )
  const mapStats = $derived(
    (data.mapStats ?? []) as Array<{
      key: string
      maps_played: number
      maps_won: number
      win_pct: number | null
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
    }>
  )
  const agentStats = $derived(
    (data.agentStats ?? []) as Array<{
      key: string
      maps_played: number
      maps_won: number
      win_pct: number | null
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
    }>
  )
  const viewer = $derived(
    (data.viewer ?? null) as {
      profileId: string
      displayName: string | null
      riotIdBase: string | null
    } | null
  )

  let riotIdBaseValue = $derived(viewer?.riotIdBase ?? base ?? '')

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

  function rankIconUrl(leagueRank: unknown): string | null {
    if (typeof leagueRank !== 'string') return null
    return rankIconUrlByKey(rankImageKey(leagueRank))
  }

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }

  const playerRank = $derived(rankLabel((data.bestRank ?? null) as string | null))

  const selectedBatchLabel = $derived.by(() => {
    if (!selected) return null
    return selected.batch?.display_name ?? selected.import_batch_id ?? null
  })

  function navToBatch(nextBatchId: string) {
    const params = new SvelteURLSearchParams()
    params.set('name', clickedName)
    if (nextBatchId) params.set('batchId', nextBatchId)
    window.location.href = `/players/unclaimed?${params.toString()}`
  }
</script>

<svelte:head><title>{clickedName}</title></svelte:head>

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
                  <span class="record" title="Maps won of this map/agent.">
                    {entry.maps_won}–{entry.maps_played - entry.maps_won}
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
          <div class="hero-logo hero-logo-empty">
            <BarChart3 size={34} />
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-end gap-2">
              <h1 class="hero-name">{clickedName}</h1>
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
            </div>
            <div class="identity-row">
              <span class="identity-note">Unclaimed stats</span>
              {#if base}
                <span class="identity-divider"></span>
                <span class="identity-note">base: {base}</span>
              {/if}
              {#if selected?.profile_id}
                <span class="identity-divider"></span>
                <span class="identity-note">linked</span>
              {/if}
            </div>
          </div>
        </div>
      </div>

      <section class="card">
        <div class="card-body">
          {#if viewer?.profileId && !viewer?.riotIdBase}
            <div
              class="mb-4 rounded-md border p-3"
              style="border-color: rgba(59,130,246,0.25); background: rgba(59,130,246,0.10);"
            >
              <div class="mb-1 text-sm font-semibold" style="color: rgba(255,255,255,0.92);">
                Claim These Stats
              </div>
              <div class="text-xs" style="color: rgba(255,255,255,0.72);">
                Enter your Riot name (base only, no #tag). We will relink any matching imports
                automatically.
              </div>

              <form class="mt-3 flex flex-col gap-2 md:flex-row" method="POST" use:enhance>
                <input
                  name="riot_id_base"
                  bind:value={riotIdBaseValue}
                  class="w-full flex-1 rounded-md border px-3 py-2 text-sm"
                  style="border-color: rgba(255,255,255,0.45); background: rgba(0,0,0,0.25); color: var(--text);"
                  placeholder={base ? `Example: ${base}` : 'Example: Ginzburg'}
                  autocomplete="off"
                />
                <button
                  type="submit"
                  formaction="?/claim"
                  class="rounded-md px-3 py-2 text-sm font-semibold"
                  style="background: rgba(74,222,128,0.2); color: var(--good);"
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

          <div class="stats-bar">
            <span class="section-label">Stats</span>
            {#if selectedBatchLabel}
              <span class="stats-batch">{selectedBatchLabel}</span>
            {/if}
            <div class="stats-controls">
              {#if batchOptions.length > 0}
                <div class="batch-select">
                  <CustomSelect
                    options={batchOptions}
                    value={batchId ?? ''}
                    compact={true}
                    onSelect={navToBatch}
                  />
                </div>
              {/if}
              {#if hasExternalContent && !viewingExternal}
                <ExternalEventsToggle label="External events" />
              {/if}
            </div>
          </div>

          {#if !selected}
            <p class="muted">No imported stats found.</p>
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
          <p class="card-empty">No match stats recorded yet.</p>
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

                <span class="row-logo row-logo-empty"></span>

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
    </div>
  </div>
</PageContainer>

<style src="./page.css"></style>
