<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { ArrowLeft, Map, RefreshCw, ShieldAlert } from 'lucide-svelte'
  import {
    DEFAULT_MAP_POOL,
    getDeciderMap,
    getPickedMaps,
    getRemainingMaps,
    normalizeMapPool,
  } from '$lib/matches/veto'

  let { data } = $props()

  const match = $derived(data.match as any)
  let actions = $state<any[]>([])

  let mapPool = $state<string[]>(DEFAULT_MAP_POOL)
  let remaining = $state<string[]>([])
  let next = $state<any>(null)
  const viewer = $derived(
    data.viewer as { role: string | null; profileId: string; teamIds?: string[] }
  )

  $effect(() => {
    actions = data.actions ?? []
    mapPool = normalizeMapPool(data.mapPool ?? match?.metadata?.map_pool ?? DEFAULT_MAP_POOL)
    remaining = data.remainingMaps ?? getRemainingMaps(mapPool, actions as any)
    next = data.next ?? null
  })

  let selectedMap = $state('')
  let isSubmitting = $state(false)
  let errorMessage = $state<string | null>(null)

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }

  function teamLabel(teamId: string) {
    if (teamId === match.team_a_id) return teamName(match.team_a)
    if (teamId === match.team_b_id) return teamName(match.team_b)
    return 'Team'
  }

  const mapOptions = $derived((remaining ?? []).map((m) => ({ label: m, value: m })))

  const pickedMaps = $derived(getPickedMaps(actions as any))
  const deciderMap = $derived(getDeciderMap(mapPool, actions as any))

  const isAdmin = $derived(viewer?.role === 'admin')
  const viewerTeamIds = $derived(viewer?.teamIds ?? [])
  const canActThisStep = $derived(
    Boolean(isAdmin || (next?.actingTeamId && viewerTeamIds.includes(next.actingTeamId)))
  )

  async function refresh() {
    errorMessage = null
    const res = await fetch(`/api/matches/${match.id}/veto`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      errorMessage = body?.message ?? 'Failed to refresh'
      return
    }
    const body = await res.json()
    actions = body.actions ?? []
    mapPool = normalizeMapPool(body.mapPool ?? mapPool)
    remaining = body.remainingMaps ?? getRemainingMaps(mapPool, actions as any)
    next = body.next
    if (selectedMap && !(remaining ?? []).includes(selectedMap)) selectedMap = ''
  }

  async function submitStep() {
    errorMessage = null
    if (!selectedMap) {
      errorMessage = 'Select a map'
      return
    }

    isSubmitting = true
    try {
      const res = await fetch(`/api/matches/${match.id}/veto`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapName: selectedMap }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.message ?? 'Failed to submit veto step')
      }

      selectedMap = ''
      await refresh()
    } catch (err: any) {
      errorMessage = err?.message ?? 'Something went wrong'
    } finally {
      isSubmitting = false
    }
  }

  async function resetVeto() {
    errorMessage = null
    const res = await fetch(`/api/matches/${match.id}/veto`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      errorMessage = body?.message ?? 'Failed to reset veto'
      return
    }
    await refresh()
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-4xl">
      <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <Map size={32} style="color: var(--text);" />
          <div>
            <h1 class="responsive-title">Map Veto</h1>
            <p class="text-sm" style="color: rgba(255,255,255,0.72);">
              {teamName(match.team_a)} vs {teamName(match.team_b)} • BO{match.best_of}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded px-2 py-1 text-xs"
            style="background: rgba(255,255,255,0.10); color: var(--text);"
            onclick={refresh}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <a
            href={`/matches/${match.id}`}
            class="inline-flex items-center gap-2 rounded px-2 py-1 text-xs"
            style="background: rgba(255,255,255,0.10); color: var(--text);"
          >
            <ArrowLeft size={14} />
            Back
          </a>
        </div>
      </div>

      {#if errorMessage}
        <div
          class="mb-4 rounded-md border p-3 text-sm"
          style="border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); color: #fecaca;"
        >
          {errorMessage}
        </div>
      {/if}

      <section
        class="rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div
          class="mb-2 text-xs font-semibold tracking-wide uppercase"
          style="color: rgba(255,255,255,0.72);"
        >
          Next Step
        </div>

        {#if next?.done}
          <p class="text-sm" style="color: rgba(255,255,255,0.78);">
            {next?.reason ?? 'Veto complete'}
          </p>
        {:else}
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div class="text-sm" style="color: rgba(255,255,255,0.82);">
              <span
                class="rounded-full px-2 py-0.5 text-xs"
                style="background: rgba(255,255,255,0.10);">#{next.nextOrder}</span
              >
              <span class="ml-2 font-semibold" style="color: var(--text);"
                >{next.actionType?.toUpperCase()}</span
              >
              <span class="ml-2" style="color: rgba(255,255,255,0.78);">by</span>
              <span class="ml-2" style="color: var(--text);">{teamLabel(next.actingTeamId)}</span>
              {#if !canActThisStep}
                <span
                  class="ml-2 rounded-full px-2 py-0.5 text-xs"
                  style="background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.75);"
                >
                  Waiting
                </span>
              {:else}
                <span
                  class="ml-2 rounded-full px-2 py-0.5 text-xs"
                  style="background: rgba(74,222,128,0.14); color: #86efac;"
                >
                  Your turn
                </span>
              {/if}
            </div>

            <div class="flex flex-col gap-2 md:flex-row md:items-center">
              <div class="min-w-[220px]">
                <CustomSelect
                  options={mapOptions}
                  bind:value={selectedMap}
                  placeholder={canActThisStep ? 'Select map' : 'Waiting for opponent'}
                  disabled={!canActThisStep}
                />
              </div>
              <button
                type="button"
                class="rounded px-3 py-2 text-xs font-semibold"
                style="background: rgba(234,179,8,0.18); color: #fde68a;"
                onclick={submitStep}
                disabled={isSubmitting || !selectedMap || !canActThisStep}
              >
                {isSubmitting ? 'Submitting...' : 'Lock In'}
              </button>
            </div>
          </div>
        {/if}

        {#if isAdmin}
          <div
            class="mt-4 rounded-md border p-3"
            style="border-color: rgba(248,113,113,0.30); background: rgba(248,113,113,0.06);"
          >
            <div class="mb-2 flex items-center gap-2">
              <ShieldAlert size={16} />
              <div
                class="text-xs font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.72);"
              >
                Admin
              </div>
            </div>
            <button
              type="button"
              class="rounded px-2 py-1 text-xs"
              style="background: rgba(248,113,113,0.2); color: #f87171;"
              onclick={resetVeto}
            >
              Reset Veto
            </button>
          </div>
        {/if}
      </section>

      <section
        class="mt-4 rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div
          class="mb-3 text-xs font-semibold tracking-wide uppercase"
          style="color: rgba(255,255,255,0.72);"
        >
          Timeline
        </div>

        {#if actions.length === 0}
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">No actions yet.</p>
        {:else}
          <div class="flex flex-col gap-2">
            {#each actions as action}
              <div
                class="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18);"
              >
                <div class="text-xs" style="color: var(--text);">
                  <span class="rounded-full px-2 py-0.5" style="background: rgba(255,255,255,0.10);"
                    >#{action.action_order}</span
                  >
                  <span class="ml-2 font-semibold" style="color: rgba(255,255,255,0.85);"
                    >{action.action_type.toUpperCase()}</span
                  >
                  <span class="ml-2">{action.map_name}</span>
                </div>
                <div class="text-xs" style="color: rgba(255,255,255,0.55);">
                  {teamLabel(action.acting_team_id)}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <section
        class="mt-4 rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div
          class="mb-3 text-xs font-semibold tracking-wide uppercase"
          style="color: rgba(255,255,255,0.72);"
        >
          Resolved
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div
            class="rounded-md border p-3"
            style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18);"
          >
            <div
              class="text-xs font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.72);"
            >
              Picks
            </div>
            <div class="mt-2 text-sm" style="color: var(--text);">
              {pickedMaps.length > 0 ? pickedMaps.join(', ') : 'None'}
            </div>
          </div>
          <div
            class="rounded-md border p-3"
            style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18);"
          >
            <div
              class="text-xs font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.72);"
            >
              Decider
            </div>
            <div class="mt-2 text-sm" style="color: var(--text);">{deciderMap ?? 'TBD'}</div>
          </div>
        </div>

        <div class="mt-3 text-xs" style="color: rgba(255,255,255,0.65);">
          Remaining: {getRemainingMaps(mapPool, actions as any).join(', ')}
        </div>
      </section>
    </div>
  </div>
</PageContainer>
