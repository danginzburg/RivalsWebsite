<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { BarChart3, Users } from 'lucide-svelte'
  import { SvelteMap, SvelteURLSearchParams } from 'svelte/reactivity'
  import { resolve } from '$app/paths'
  import { enhance } from '$app/forms'
  import miksIcon from '$lib/assets/agents/Miks_icon.webp'
  import { rankImageKey } from '$lib/ranks/ranks'

  let { data, form }: PageProps = $props()

  const clickedName = $derived(String(data.clickedName ?? 'Player'))
  const base = $derived(String(data.base ?? ''))
  const batchId = $derived(data.batchId ?? null)
  const allBatchOptions = $derived(
    (data.batchOptions ?? []) as Array<{
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
  const selected = $derived(data.selected ?? null)
  const matchHistory = $derived(data.matchHistory ?? [])
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

  function navToBatch(nextBatchId: string) {
    const params = new SvelteURLSearchParams()
    params.set('name', clickedName)
    if (nextBatchId) params.set('batchId', nextBatchId)
    window.location.href = `/players/unclaimed?${params.toString()}`
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl min-w-0">
      <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <BarChart3 size={34} style="color: var(--text);" />
          <div>
            <div class="flex items-center gap-2">
              <h1 class="responsive-title">{clickedName}</h1>
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
            <p class="text-sm" style="color: rgba(255,255,255,0.72);">
              Unclaimed stats
              {#if base}
                <span class="opacity-80"> • base: {base}</span>
              {/if}
              {#if selected?.profile_id}
                <span class="opacity-80"> • linked</span>
              {/if}
            </p>
          </div>
        </div>

        <div></div>
      </div>

      <section
        class="overflow-hidden rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
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
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                placeholder={base ? `Example: ${base}` : 'Example: Ginzburg'}
                autocomplete="off"
              />
              <button
                type="submit"
                formaction="?/claim"
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

        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div
            class="text-xs font-semibold tracking-wide uppercase"
            style="color: rgba(255,255,255,0.72);"
          >
            Stats
          </div>
          <div class="flex items-center gap-2">
            {#if hasAnyWeeks}
              <button
                type="button"
                class="rounded-md border px-3 py-2 text-xs"
                style={hideWeeks
                  ? 'border-color: rgba(59,130,246,0.5); background: rgba(59,130,246,0.18); color: #93c5fd;'
                  : 'border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: rgba(255,255,255,0.72);'}
                onclick={() => (hideWeeks = !hideWeeks)}
              >
                Hide Weeks
              </button>
            {/if}
            {#if batchOptions.length > 0}
              <div class="min-w-[260px]">
                <CustomSelect
                  options={batchOptions}
                  value={batchId ?? ''}
                  compact={true}
                  onSelect={navToBatch}
                />
              </div>
            {/if}
          </div>
        </div>

        {#if !selected}
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">No imported stats found.</p>
        {:else}
          <div class="mb-3 text-sm" style="color: rgba(255,255,255,0.78);">
            {selected.batch?.display_name ?? selected.import_batch_id}
            {#if selected.batch?.import_kind === 'weekly' && selected.batch?.week_label}
              <span class="opacity-80"> • {selected.batch.week_label}</span>
            {/if}
          </div>

          <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
            >
              <div class="text-xs" style="color: rgba(255,255,255,0.65);">Games</div>
              <div class="text-lg font-semibold" style="color: var(--text);">
                {selected.games ?? '—'}
              </div>
            </div>
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
            >
              <div class="text-xs" style="color: rgba(255,255,255,0.65);">ACS</div>
              <div class="text-lg font-semibold" style="color: var(--text);">
                {fmt(selected.acs, 0)}
              </div>
            </div>
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
            >
              <div class="text-xs" style="color: rgba(255,255,255,0.65);">K/D</div>
              <div class="text-lg font-semibold" style="color: var(--text);">
                {fmt(selected.kd, 2)}
              </div>
            </div>
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
            >
              <div class="text-xs" style="color: rgba(255,255,255,0.65);">ADR</div>
              <div class="text-lg font-semibold" style="color: var(--text);">
                {fmt(selected.adr, 0)}
              </div>
            </div>
          </div>

          <div
            class="mt-4 rounded-md border p-3"
            style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
          >
            <div class="mb-2 flex items-center gap-2">
              <Users size={16} />
              <div
                class="text-xs font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.72);"
              >
                Agents
              </div>
            </div>
            {#if parseAgents(selected.agents).length === 0}
              <div class="text-sm" style="color: rgba(255,255,255,0.72);">—</div>
            {:else}
              <div class="agents-icons">
                {#each parseAgents(selected.agents) as agent (agent)}
                  {@const url = agentIconUrl(agent)}
                  {#if url}
                    <img
                      src={url}
                      alt={agent}
                      title={agent}
                      class="h-7 w-7 rounded-sm object-contain"
                      style="background: rgba(0,0,0,0.15);"
                    />
                  {:else}
                    <span
                      class="inline-flex h-7 w-7 items-center justify-center rounded-sm border text-[10px] font-bold"
                      style="border-color: rgba(255,255,255,0.15); color: rgba(255,255,255,0.8);"
                      title={agent}
                    >
                      {agent.slice(0, 3).toUpperCase()}
                    </span>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        {#if mapStats.length > 0 || agentStats.length > 0}
          <div class="mt-4 flex flex-col gap-4">
            {#if mapStats.length > 0}
              <section
                class="rounded-md border p-4"
                style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
              >
                <div class="mb-3">
                  <div
                    class="text-xs font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.72);"
                  >
                    Map Stats
                  </div>
                </div>
                <div class="overflow-x-auto">
                  <table class="min-w-full text-left text-sm">
                    <thead>
                      <tr
                        class="text-xs tracking-wide uppercase"
                        style="color: rgba(255,255,255,0.75);"
                      >
                        <th class="px-3 py-2">Map</th>
                        <th class="px-3 py-2">Played</th>
                        <th class="px-3 py-2">Win%</th>
                        <th class="px-3 py-2">ACS</th>
                        <th class="px-3 py-2">K/D</th>
                        <th class="px-3 py-2">ADR</th>
                        <th class="px-3 py-2">KAST</th>
                        <th class="px-3 py-2">HS%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each mapStats as entry (entry.key)}
                        <tr class="border-t" style="border-color: rgba(255,255,255,0.10);">
                          <td class="px-3 py-2 font-medium" style="color: var(--text);">
                            {entry.key}
                          </td>
                          <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                            {entry.maps_played}
                          </td>
                          <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                            {entry.win_pct != null ? `${fmt(entry.win_pct, 0)}%` : '—'}
                          </td>
                          <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                            {fmt(entry.acs, 0)}
                          </td>
                          <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                            {fmt(entry.kd, 2)}
                          </td>
                          <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                            {fmt(entry.adr, 0)}
                          </td>
                          <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                            {fmt(entry.kast_pct, 0)}%
                          </td>
                          <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                            {fmt(entry.hs_pct, 0)}%
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </section>
            {/if}

            {#if agentStats.length > 0}
              <section
                class="rounded-md border p-4"
                style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
              >
                <div class="mb-3">
                  <div
                    class="text-xs font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.72);"
                  >
                    Agent Stats
                  </div>
                </div>
                <div class="overflow-x-auto">
                  <table class="min-w-full text-left text-sm">
                    <thead>
                      <tr
                        class="text-xs tracking-wide uppercase"
                        style="color: rgba(255,255,255,0.75);"
                      >
                        <th class="px-3 py-2">Agent</th>
                        <th class="px-3 py-2">Played</th>
                        <th class="px-3 py-2">Win%</th>
                        <th class="px-3 py-2">ACS</th>
                        <th class="px-3 py-2">K/D</th>
                        <th class="px-3 py-2">ADR</th>
                        <th class="px-3 py-2">KAST</th>
                        <th class="px-3 py-2">HS%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each agentStats as entry (entry.key)}
                        <tr class="border-t" style="border-color: rgba(255,255,255,0.10);">
                          <td class="px-3 py-2" style="color: var(--text);">
                            <div class="flex items-center gap-2">
                              {#if agentIconUrl(entry.key)}
                                <img
                                  src={agentIconUrl(entry.key) ?? ''}
                                  alt={entry.key}
                                  class="h-6 w-6 rounded-sm object-contain"
                                  style="background: rgba(0,0,0,0.15);"
                                />
                              {/if}
                              <span class="font-medium">{entry.key}</span>
                            </div>
                          </td>
                          <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                            {entry.maps_played}
                          </td>
                          <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                            {entry.win_pct != null ? `${fmt(entry.win_pct, 0)}%` : '—'}
                          </td>
                          <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                            {fmt(entry.acs, 0)}
                          </td>
                          <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                            {fmt(entry.kd, 2)}
                          </td>
                          <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                            {fmt(entry.adr, 0)}
                          </td>
                          <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                            {fmt(entry.kast_pct, 0)}%
                          </td>
                          <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                            {fmt(entry.hs_pct, 0)}%
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </section>
            {/if}
          </div>
        {/if}

        <section
          class="mt-4 rounded-md border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="mb-3 flex items-center gap-2">
            <BarChart3 size={16} />
            <div
              class="text-xs font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.72);"
            >
              Match History
            </div>
          </div>

          {#if matchHistory.length === 0}
            <p class="text-sm" style="color: rgba(255,255,255,0.72);">
              No match stats recorded yet.
            </p>
          {:else}
            <div class="overflow-x-auto">
              <table class="min-w-full text-left text-sm">
                <thead>
                  <tr
                    class="text-xs tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.75);"
                  >
                    <th class="px-3 py-2">Opponent</th>
                    <th class="px-3 py-2">Agent</th>
                    <th class="px-3 py-2">ACS</th>
                    <th class="px-3 py-2">K/D/A</th>
                    <th class="px-3 py-2">KAST</th>
                    <th class="px-3 py-2">HS%</th>
                    <th class="px-3 py-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {#each matchHistory as entry (entry.match.id)}
                    <tr class="border-t" style="border-color: rgba(255,255,255,0.10);">
                      <td class="px-3 py-2" style="color: var(--text);">
                        <a
                          href={resolve(`/matches/${entry.match.id}`)}
                          class="underline"
                          style="color: var(--text);">vs {entry.opponent?.name ?? 'Team'}</a
                        >
                      </td>
                      <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                        {#if parseAgents(entry.agents).length === 0}
                          —
                        {:else}
                          <div class="agents-icons">
                            {#each parseAgents(entry.agents) as agent (agent)}
                              {@const url = agentIconUrl(agent)}
                              {#if url}
                                <img
                                  src={url}
                                  alt={agent}
                                  title={agent}
                                  class="h-7 w-7 rounded-sm object-contain"
                                  style="background: rgba(0,0,0,0.15);"
                                />
                              {:else}
                                <span
                                  class="inline-flex h-7 w-7 items-center justify-center rounded-sm border text-[10px] font-bold"
                                  style="border-color: rgba(255,255,255,0.15); color: rgba(255,255,255,0.8);"
                                  title={agent}>{agent.slice(0, 3).toUpperCase()}</span
                                >
                              {/if}
                            {/each}
                          </div>
                        {/if}
                      </td>
                      <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);"
                        >{fmt(entry.acs, 0)}</td
                      >
                      <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);"
                        >{entry.kills}/{entry.deaths}/{entry.assists}</td
                      >
                      <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);"
                        >{fmt(entry.kast_pct, 0)}%</td
                      >
                      <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);"
                        >{fmt(entry.hs_pct, 0)}%</td
                      >
                      <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);"
                        >{entry.score.us}-{entry.score.them}</td
                      >
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </section>
      </section>
    </div>
  </div>
</PageContainer>

<style>
  .agents-icons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>
