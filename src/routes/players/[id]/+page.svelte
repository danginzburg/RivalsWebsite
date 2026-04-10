<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { BarChart3, Users, Swords, User } from 'lucide-svelte'
  import miksIcon from '$lib/assets/agents/Miks_icon.png'

  import { enhance } from '$app/forms'

  let { data, form }: PageProps = $props()

  const player = $derived(data.player)
  const activeTeam = $derived(data.activeTeam)
  const viewer = $derived(data.viewer ?? { canEditRiotIdBase: false })
  const selected = $derived(data.stats?.selected ?? null)
  const selectedBatchId = $derived(data.stats?.selectedBatchId ?? null)
  const batchOptions = $derived(data.stats?.batchOptions ?? [])
  const matchHistory = $derived(data.matchHistory ?? [])

  let riotIdBaseValue = $state('')
  let statsPlayerNameValue = $state('')
  $effect(() => {
    riotIdBaseValue = player.riot_id_base ?? ''
    statsPlayerNameValue = player.stats_player_name ?? ''
  })

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

  function navToBatch(batchId: string) {
    window.location.href = `/players/${player.profile_id}?batchId=${encodeURIComponent(batchId)}`
  }

  function formatUtc(value: string | null | undefined) {
    if (!value) return 'Date TBD'
    const date = new Date(value)
    return `${date.toLocaleString(undefined, { timeZone: 'UTC' })} UTC`
  }

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl">
      <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div class="flex items-start gap-4">
          {#if activeTeam?.logo_url}
            <img
              src={activeTeam.logo_url}
              alt="{activeTeam.name} logo"
              class="h-20 w-20 rounded object-contain md:h-24 md:w-24"
            />
          {:else}
            <div
              class="flex h-20 w-20 items-center justify-center rounded border md:h-24 md:w-24"
              style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18);"
            >
              <User size={34} style="color: var(--text);" />
            </div>
          {/if}
          <div>
            <h1 class="responsive-title">{player.riot_id}</h1>
            {#if activeTeam}
              <a
                href={`/teams/${activeTeam.id}`}
                class="mt-2 inline-flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-white/5"
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
                  <span class="text-sm capitalize" style="color: rgba(255,255,255,0.52);"
                    >{activeTeam.role}</span
                  >
                {/if}
              </a>
            {:else}
              <p class="mt-2 text-sm" style="color: rgba(255,255,255,0.72);">No active team</p>
            {/if}
          </div>
        </div>

        <div></div>
      </div>

      <section
        class="rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
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
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
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
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
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

        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div
            class="text-xs font-semibold tracking-wide uppercase"
            style="color: rgba(255,255,255,0.72);"
          >
            Stats
          </div>
          {#if batchOptions.length > 0}
            <div class="min-w-[260px]">
              <CustomSelect
                options={batchOptions}
                value={selectedBatchId ?? ''}
                compact={true}
                onSelect={navToBatch}
              />
            </div>
          {/if}
        </div>

        {#if !selected}
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">
            No imported stats found for this player.
          </p>
        {:else}
          <div class="mb-3 text-sm" style="color: rgba(255,255,255,0.78);">
            {selected.batch?.display_name ?? selected.import_batch_id}
            {#if selected.batch?.import_kind === 'weekly' && selected.batch?.week_label}
              <span class="opacity-80"> • {selected.batch.week_label}</span>
            {/if}
          </div>

          <div class="grid grid-cols-2 gap-3 md:grid-cols-5">
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
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
            >
              <div class="text-xs" style="color: rgba(255,255,255,0.65);">HS%</div>
              <div class="text-lg font-semibold" style="color: var(--text);">
                {fmt(selected.hs_pct, 0)}
              </div>
            </div>
          </div>

          <div
            class="mt-4 rounded-md border p-3"
            style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
          >
            <div class="mb-2 flex items-center gap-2">
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
                {#each parseAgents(selected.agents) as agent}
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
      </section>

      <section
        class="mt-4 rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div class="mb-3 flex items-center gap-2">
          <div
            class="text-xs font-semibold tracking-wide uppercase"
            style="color: rgba(255,255,255,0.72);"
          >
            Match History
          </div>
        </div>

        {#if matchHistory.length === 0}
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">
            No participation stats recorded yet.
          </p>
        {:else}
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead>
                <tr class="text-xs tracking-wide uppercase" style="color: rgba(255,255,255,0.75);">
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
                {#each matchHistory as entry}
                  {@const match = entry.match}
                  {@const opp = entry.opponent}
                  {@const score = entry.score}
                  <tr class="border-t" style="border-color: rgba(255,255,255,0.10);">
                    <td class="px-3 py-2" style="color: var(--text);">
                      <a
                        href={`/matches/${match.id}`}
                        class="underline"
                        style="color: var(--text);"
                      >
                        vs {teamName(opp)}
                      </a>
                    </td>
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                      {#if parseAgents(entry.agents).length === 0}
                        —
                      {:else}
                        <div class="agents-icons">
                          {#each parseAgents(entry.agents) as agent}
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
                    </td>
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                      {fmt(entry.acs, 0)}
                    </td>
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                      {entry.kills ?? 0}/{entry.deaths ?? 0}/{entry.assists ?? 0}
                    </td>
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);"
                      >{fmt(entry.kast_pct, 0)}%</td
                    >
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);"
                      >{fmt(entry.hs_pct, 0)}%</td
                    >
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);"
                      >{score.us}-{score.them}</td
                    >
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    </div>
  </div>
</PageContainer>

<style>
  .agents-icons {
    display: inline-grid;
    grid-template-rows: 28px;
    grid-auto-flow: column;
    grid-auto-columns: 28px;
    gap: 6px;
  }

  @media (max-width: 768px) {
    .agents-icons {
      grid-template-rows: 28px 28px;
    }
  }
</style>
