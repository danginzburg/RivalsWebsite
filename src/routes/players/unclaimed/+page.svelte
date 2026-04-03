<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { BarChart3, Users } from 'lucide-svelte'
  import { enhance } from '$app/forms'

  let { data, form } = $props() as { data: any; form: any }

  const clickedName = $derived(String(data.clickedName ?? 'Player'))
  const base = $derived(String(data.base ?? ''))
  const batchId = $derived((data.batchId ?? null) as string | null)
  const batchOptions = $derived(
    (data.batchOptions ?? []) as Array<{ label: string; value: string }>
  )
  const selected = $derived((data.selected ?? null) as any | null)
  const viewer = $derived(
    (data.viewer ?? null) as {
      profileId: string
      displayName: string | null
      riotIdBase: string | null
    } | null
  )

  let riotIdBaseValue = $state('')
  $effect(() => {
    riotIdBaseValue = viewer?.riotIdBase ?? base ?? ''
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

  function navToBatch(nextBatchId: string) {
    const params = new URLSearchParams()
    params.set('name', clickedName)
    if (nextBatchId) params.set('batchId', nextBatchId)
    window.location.href = `/players/unclaimed?${params.toString()}`
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl">
      <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <BarChart3 size={34} style="color: var(--text);" />
          <div>
            <h1 class="responsive-title">{clickedName}</h1>
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
        class="rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        {#if viewer?.profileId}
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
