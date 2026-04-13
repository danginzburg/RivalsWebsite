<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { BarChart3, CalendarDays, RadioTower, Video } from 'lucide-svelte'
  import miksIcon from '$lib/assets/agents/Miks_icon.png'

  let { data }: PageProps = $props()

  const match = $derived(data.match)
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

  function formatUtc(value: string | null | undefined) {
    if (!value) return 'Date TBD'
    const date = new Date(value)
    return date.toLocaleString()
  }

  function formatStatus(status: string | null | undefined) {
    if (!status) return 'Unknown'
    return status.charAt(0).toUpperCase() + status.slice(1)
  }

  function playerLabel(row: { profile_name?: string | null; player_name?: string | null }) {
    return row.profile_name ?? row.player_name ?? 'Player'
  }

  function playerHref(row: { profile_id?: string | null; player_name?: string | null }) {
    if (row.profile_id) return `/players/${row.profile_id}`
    return `/players/unclaimed?name=${encodeURIComponent(row.player_name ?? '')}`
  }

  function fmt(value: unknown, digits = 0) {
    const num = Number(value)
    return Number.isFinite(num) ? num.toFixed(digits) : '0'
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

  const agentAssetModules = import.meta.glob('$lib/assets/agents/*_icon.png', {
    eager: true,
    import: 'default',
  }) as Record<string, string>

  const agentIconMap = $derived.by(() => {
    const map = new Map<string, string>()
    const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')

    for (const [path, url] of Object.entries(agentAssetModules)) {
      const filename = path.split('/').pop() ?? ''
      const base = filename.replace(/_icon\.png$/i, '')
      map.set(normalize(base), url)
    }

    if (map.has('harbor')) map.set('harbour', map.get('harbor')!)
    map.set('miks', miksIcon)
    return map
  })

  function agentIconUrl(agentName: string): string | null {
    const key = String(agentName ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    return agentIconMap.get(key) ?? null
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
      label: `${map.map_label}${map.map_name ? ` • ${map.map_name}` : ''}`,
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
    })),
    {
      key: 'total',
      label: 'Series Total',
      team_a_rounds: null,
      team_b_rounds: null,
      rows: match.total_stats ?? [],
      isTotal: true,
      forfeit: null,
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
  const teamAStats = $derived(
    sortByKillsDesc((activeStats?.rows ?? []).filter((row) => row.team_id === match.team_a_id))
  )
  const teamBStats = $derived(
    sortByKillsDesc((activeStats?.rows ?? []).filter((row) => row.team_id === match.team_b_id))
  )
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-[96rem]">
      <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div>
            <h1 class="responsive-title flex flex-wrap items-center gap-3">
              <span class="inline-flex items-center gap-2">
                {#if teamLogo(match.team_a)}
                  <img
                    src={teamLogo(match.team_a)}
                    alt="{teamName(match.team_a)} logo"
                    class="h-10 w-10 rounded object-contain"
                  />
                {/if}
                <a href={`/teams/${match.team_a?.id}`} class="hover:underline"
                  >{teamName(match.team_a)}</a
                >
              </span>
              <span class="inline-flex items-center gap-2">
                <span>vs</span>
              </span>
              <span class="inline-flex items-center gap-2">
                {#if teamLogo(match.team_b)}
                  <img
                    src={teamLogo(match.team_b)}
                    alt="{teamName(match.team_b)} logo"
                    class="h-10 w-10 rounded object-contain"
                  />
                {/if}
                <a href={`/teams/${match.team_b?.id}`} class="hover:underline"
                  >{teamName(match.team_b)}</a
                >
              </span>
            </h1>
            <p class="text-sm" style="color: rgba(255,255,255,0.72);">
              BO{match.best_of} • {formatUtc(match.scheduled_at)}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span
            class="rounded-full px-2 py-1 text-xs font-bold"
            style="background: rgba(255,255,255,0.12); color: var(--text);"
          >
            {formatStatus(match.status)}
          </span>
          {#if match.status === 'completed'}
            <span
              class="rounded-full px-2 py-1 text-xs font-bold"
              style="background: rgba(34,197,94,0.18); color: #86efac;"
            >
              Final {match.team_a_score}-{match.team_b_score}
            </span>
          {/if}
        </div>
      </div>

      {#if match.forfeit_display}
        <div
          class="mb-4 rounded-md border p-3 text-sm leading-relaxed"
          style="border-color: rgba(251,191,36,0.4); background: rgba(251,191,36,0.08); color: rgba(255,255,255,0.9);"
        >
          {#if match.forfeit_display.kind === 'admin_award'}
            <div class="font-semibold" style="color: #fcd34d;">Series result (forfeit)</div>
            <p class="mt-1">
              Official winner:
              <span style="color: var(--text);">{match.forfeit_display.winnerTeamName ?? '—'}</span
              >. Map scores ({match.team_a_score}-{match.team_b_score}) reflect play on the server.
              {#if match.forfeit_display.forfeitingTeamName}
                <span class="mt-1 block">
                  Forfeiting side (penalized / lost the series): {match.forfeit_display
                    .forfeitingTeamName}.
                </span>
              {/if}
              {#if match.forfeit_display.reason}
                <span class="mt-1 block text-xs" style="color: rgba(255,255,255,0.75);"
                  >{match.forfeit_display.reason}</span
                >
              {/if}
            </p>
          {:else if match.forfeit_display.kind === 'no_show'}
            <div class="font-semibold" style="color: #fcd34d;">No-show forfeit</div>
            <p class="mt-1">
              Winner:
              <span style="color: var(--text);">{match.forfeit_display.winnerTeamName ?? '—'}</span
              >.
              {#if match.forfeit_display.forfeitingTeamName}
                Opponent did not field a team in time: {match.forfeit_display.forfeitingTeamName}.
              {/if}
            </p>
          {/if}
        </div>
      {/if}

      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section
          class="rounded-md border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="mb-3 flex items-center gap-2">
            <CalendarDays size={18} />
            <h2
              class="text-sm font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.8);"
            >
              Details
            </h2>
          </div>

          <div class="space-y-2 text-sm" style="color: rgba(255,255,255,0.78);">
            <div>
              <span style="color: rgba(255,255,255,0.55);">Scheduled:</span>
              <span class="ml-2" style="color: var(--text);">{formatUtc(match.scheduled_at)}</span>
            </div>
            {#if match.started_at}
              <div>
                <span style="color: rgba(255,255,255,0.55);">Started:</span>
                <span class="ml-2" style="color: var(--text);">{formatUtc(match.started_at)}</span>
              </div>
            {/if}
            {#if (match.metadata?.map_vetoes?.length ?? 0) > 0}
              <div>
                <div style="color: rgba(255,255,255,0.55);">Map Veto:</div>
                <div class="mt-2 space-y-2" style="color: var(--text);">
                  {#each match.metadata.map_vetoes as veto, index}
                    <div class="flex items-start gap-2 leading-5">
                      <span class="w-5 shrink-0 text-right" style="color: rgba(255,255,255,0.55);">
                        {index + 1}.
                      </span>
                      <span class="flex-1">{veto}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </section>

        <section
          class="rounded-md border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="mb-3 flex items-center gap-2">
            <RadioTower size={18} />
            <h2
              class="text-sm font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.8);"
            >
              Streams
            </h2>
          </div>

          {#if (match.streams ?? []).length === 0}
            <p class="text-sm" style="color: rgba(255,255,255,0.72);">No streams listed yet.</p>
          {:else}
            <div class="flex flex-col gap-2">
              {#each match.streams as stream}
                <a
                  href={stream.stream_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="rounded-md border p-3 text-sm"
                  style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18); color: var(--text);"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div>
                      <strong>{stream.metadata?.display_name || stream.platform}</strong>
                      {#if stream.is_primary}
                        <span
                          class="ml-2 rounded-full px-2 py-0.5 text-xs"
                          style="background: rgba(59,130,246,0.2); color: #93c5fd;">Primary</span
                        >
                      {/if}
                    </div>
                    <span
                      class="rounded-full px-2 py-0.5 text-xs"
                      style="background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.8);"
                      >{stream.status}</span
                    >
                  </div>
                  <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.65);">
                    {stream.stream_url}
                  </div>
                </a>
              {/each}
            </div>
          {/if}

          {#if match.vod_url}
            <div class="mt-4">
              <a
                href={match.vod_url}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                style="border-color: rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: var(--text);"
              >
                <Video size={16} />
                Watch YouTube VOD
              </a>
            </div>
          {/if}
        </section>
      </div>

      <section
        class="mt-4 rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div class="mb-3 flex items-center gap-2">
          <BarChart3 size={18} />
          <h2
            class="text-sm font-semibold tracking-wide uppercase"
            style="color: rgba(255,255,255,0.8);"
          >
            Match Stats
          </h2>
        </div>

        {#if statsTabs.length <= 1 && (match.total_stats?.length ?? 0) === 0}
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">No map stats imported yet.</p>
        {:else}
          <div class="mb-4 flex flex-wrap gap-2">
            {#each statsTabs as tab}
              <button
                type="button"
                class="rounded-md px-3 py-2 text-sm font-semibold transition-colors"
                style={activeStatsTab === tab.key
                  ? 'background: rgba(59,130,246,0.2); color: #93c5fd; border: 1px solid rgba(59,130,246,0.28);'
                  : 'background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.78); border: 1px solid rgba(255,255,255,0.10);'}
                onclick={() => (activeStatsTab = String(tab.key))}
              >
                {tab.label}
              </button>
            {/each}
          </div>

          {#if activeStats}
            {#if !activeStats.isTotal}
              {#if activeStats.forfeit?.forfeiting_team_id}
                <div
                  class="mb-3 rounded-md border p-2 text-xs leading-relaxed"
                  style="border-color: rgba(251,191,36,0.35); background: rgba(251,191,36,0.06); color: rgba(255,255,255,0.88);"
                >
                  <span class="font-semibold" style="color: #fcd34d;">Forfeit note (this map)</span>
                  {#if activeStats.forfeit.forfeiting_team_name}
                    <span class="ml-1"
                      >— {activeStats.forfeit.forfeiting_team_name} forfeited this map in the context
                      of the series ruling.</span
                    >
                  {/if}
                  {#if activeStats.forfeit.label}
                    <span class="mt-1 block">{activeStats.forfeit.label}</span>
                  {/if}
                </div>
              {/if}
              <div class="mb-3 text-sm" style="color: rgba(255,255,255,0.74);">
                {teamName(match.team_a)}
                {activeStats.team_a_rounds}-{activeStats.team_b_rounds}
                {teamName(match.team_b)}
              </div>
            {:else if (match.maps ?? []).length > 0}
              <div class="mb-3 flex flex-wrap gap-2 text-sm">
                {#each match.maps as map}
                  <div
                    class="rounded-md border px-3 py-2"
                    style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.82);"
                  >
                    <div class="font-semibold">{map.map_label}</div>
                    <div class="mt-1" style="color: rgba(255,255,255,0.62);">
                      {#if map.map_name}{map.map_name}{:else}Map{/if}
                    </div>
                    <div class="mt-1" style="color: var(--text);">
                      {teamName(match.team_a)}
                      {map.team_a_rounds}-{map.team_b_rounds}
                      {teamName(match.team_b)}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}

            <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div>
                <div class="mb-2 text-sm font-semibold" style="color: var(--text);">
                  {teamName(match.team_a)}
                </div>
                <div
                  class="overflow-x-auto rounded-md border"
                  style="border-color: rgba(255,255,255,0.10);"
                >
                  <table class="min-w-full text-left text-sm">
                    <thead>
                      <tr
                        class="text-xs uppercase"
                        style="color: rgba(255,255,255,0.65); background: rgba(255,255,255,0.04);"
                      >
                        <th class="px-3 py-2">Player</th>
                        <th class="px-3 py-2">Agent</th>
                        <th class="px-3 py-2">ACS</th>
                        <th class="px-3 py-2">K</th>
                        <th class="px-3 py-2">D</th>
                        <th class="px-3 py-2">A</th>
                        <th class="px-3 py-2">KD</th>
                        <th class="px-3 py-2">ADR</th>
                        <th class="px-3 py-2">KAST</th>
                        <th class="px-3 py-2">HS%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each teamAStats as row}
                        <tr
                          class="border-t"
                          style="border-color: rgba(255,255,255,0.08); color: rgba(255,255,255,0.9);"
                        >
                          <td class="px-3 py-2 font-semibold" style="color: var(--text);">
                            <a
                              href={playerHref(row)}
                              class="transition-colors hover:text-[#93c5fd] hover:underline"
                              style="color: var(--text);"
                            >
                              {playerLabel(row)}
                            </a>
                          </td>
                          <td class="px-3 py-2">
                            <div class="flex flex-wrap gap-1">
                              {#each parseAgents(row.agents) as agent}
                                {#if agentIconUrl(agent)}
                                  <img
                                    src={agentIconUrl(agent)}
                                    alt={agent}
                                    title={agent}
                                    class="h-6 w-6 rounded object-contain"
                                  />
                                {:else}
                                  <span class="text-xs">{agent}</span>
                                {/if}
                              {/each}
                            </div>
                          </td>
                          <td class="px-3 py-2">{fmt(row.acs, 0)}</td>
                          <td class="px-3 py-2">{fmt(row.kills, 0)}</td>
                          <td class="px-3 py-2">{fmt(row.deaths, 0)}</td>
                          <td class="px-3 py-2">{fmt(row.assists, 0)}</td>
                          <td class="px-3 py-2">{fmt(row.kd, 2)}</td>
                          <td class="px-3 py-2">{fmt(row.adr, 0)}</td>
                          <td class="px-3 py-2">{fmt(row.kast_pct, 0)}%</td>
                          <td class="px-3 py-2">{fmt(row.hs_pct, 0)}%</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div class="mb-2 text-sm font-semibold" style="color: var(--text);">
                  {teamName(match.team_b)}
                </div>
                <div
                  class="overflow-x-auto rounded-md border"
                  style="border-color: rgba(255,255,255,0.10);"
                >
                  <table class="min-w-full text-left text-sm">
                    <thead>
                      <tr
                        class="text-xs uppercase"
                        style="color: rgba(255,255,255,0.65); background: rgba(255,255,255,0.04);"
                      >
                        <th class="px-3 py-2">Player</th>
                        <th class="px-3 py-2">Agent</th>
                        <th class="px-3 py-2">ACS</th>
                        <th class="px-3 py-2">K</th>
                        <th class="px-3 py-2">D</th>
                        <th class="px-3 py-2">A</th>
                        <th class="px-3 py-2">KD</th>
                        <th class="px-3 py-2">ADR</th>
                        <th class="px-3 py-2">KAST</th>
                        <th class="px-3 py-2">HS%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each teamBStats as row}
                        <tr
                          class="border-t"
                          style="border-color: rgba(255,255,255,0.08); color: rgba(255,255,255,0.9);"
                        >
                          <td class="px-3 py-2 font-semibold" style="color: var(--text);">
                            <a
                              href={playerHref(row)}
                              class="transition-colors hover:text-[#93c5fd] hover:underline"
                              style="color: var(--text);"
                            >
                              {playerLabel(row)}
                            </a>
                          </td>
                          <td class="px-3 py-2">
                            <div class="flex flex-wrap gap-1">
                              {#each parseAgents(row.agents) as agent}
                                {#if agentIconUrl(agent)}
                                  <img
                                    src={agentIconUrl(agent)}
                                    alt={agent}
                                    title={agent}
                                    class="h-6 w-6 rounded object-contain"
                                  />
                                {:else}
                                  <span class="text-xs">{agent}</span>
                                {/if}
                              {/each}
                            </div>
                          </td>
                          <td class="px-3 py-2">{fmt(row.acs, 0)}</td>
                          <td class="px-3 py-2">{fmt(row.kills, 0)}</td>
                          <td class="px-3 py-2">{fmt(row.deaths, 0)}</td>
                          <td class="px-3 py-2">{fmt(row.assists, 0)}</td>
                          <td class="px-3 py-2">{fmt(row.kd, 2)}</td>
                          <td class="px-3 py-2">{fmt(row.adr, 0)}</td>
                          <td class="px-3 py-2">{fmt(row.kast_pct, 0)}%</td>
                          <td class="px-3 py-2">{fmt(row.hs_pct, 0)}%</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          {/if}
        {/if}
      </section>
    </div>
  </div>
</PageContainer>
