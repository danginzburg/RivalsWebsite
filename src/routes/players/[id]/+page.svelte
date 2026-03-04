<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { BarChart3, Users, Swords } from 'lucide-svelte'

  import { enhance } from '$app/forms'

  let { data, form } = $props() as { data: any; form: any }

  const player = $derived(data.player)
  const activeTeam = $derived(data.activeTeam)
  const viewer = $derived(data.viewer ?? { canEditRiotIdBase: false })
  const statsRows = $derived((data.stats?.rows ?? []) as any[])
  const selected = $derived((data.stats?.selected ?? null) as any | null)
  const selectedBatchId = $derived((data.stats?.selectedBatchId ?? null) as string | null)
  const matchHistory = $derived((data.matchHistory ?? []) as any[])

  let riotIdBaseValue = $state('')
  $effect(() => {
    riotIdBaseValue = player.riot_id_base ?? ''
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

  const batchOptions = $derived.by(() => {
    const seen = new Set<string>()
    const opts: Array<{ label: string; value: string }> = []
    for (const r of statsRows) {
      const id = r.import_batch_id
      if (!id || seen.has(id)) continue
      seen.add(id)
      const b = r.batch
      const label = `${b?.display_name ?? id}${b?.import_kind === 'weekly' && b?.week_label ? ` (${b.week_label})` : ''}`
      opts.push({ label, value: id })
    }
    return opts
  })

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

  function opponentFor(match: any, teamId: string) {
    return match?.team_a_id === teamId ? match?.team_b : match?.team_a
  }

  function scoreFor(match: any, teamId: string) {
    const a = Number(match?.team_a_score ?? 0)
    const b = Number(match?.team_b_score ?? 0)
    if (match?.team_a_id === teamId) return { us: a, them: b }
    return { us: b, them: a }
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl">
      <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <BarChart3 size={34} style="color: var(--text);" />
          <div>
            <h1 class="responsive-title">{player.riot_id}</h1>
            <p class="text-sm" style="color: rgba(255,255,255,0.72);">
              {#if activeTeam}
                <a href={`/teams/${activeTeam.id}`} style="color: #93c5fd;">{activeTeam.name}</a>
                {#if activeTeam.tag}
                  <span> [{String(activeTeam.tag).toUpperCase()}]</span>
                {/if}
                {#if activeTeam.role}
                  <span class="opacity-80"> • {activeTeam.role}</span>
                {/if}
              {:else}
                No active team
              {/if}
            </p>
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
          <Swords size={18} />
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
                  <th class="px-3 py-2">Match</th>
                  <th class="px-3 py-2">When</th>
                  <th class="px-3 py-2">Result</th>
                  <th class="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {#each matchHistory as entry}
                  {@const match = entry.match}
                  {@const opp = opponentFor(match, entry.team_id)}
                  {@const score = scoreFor(match, entry.team_id)}
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
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);"
                      >{formatUtc(match.ended_at ?? match.scheduled_at)}</td
                    >
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                      {score.us}-{score.them}
                    </td>
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">{entry.status}</td>
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
