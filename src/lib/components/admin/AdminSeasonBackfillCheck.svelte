<script lang="ts">
  import { onMount } from 'svelte'
  import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-svelte'

  /*
   * What each past season is still missing. Loaded on its own so the admin
   * dashboard does not wait on bracket and standings reads for every season.
   */
  type Issue = { level: 'blocking' | 'minor'; message: string }
  type SeasonAudit = { id: string; name: string; kind: string | null; issues: Issue[] }

  let audits = $state<SeasonAudit[] | null>(null)
  let loadError = $state<string | null>(null)
  let loading = $state(false)

  async function load() {
    loading = true
    loadError = null
    try {
      const res = await fetch('/api/admin/seasons/audit')
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      audits = ((await res.json()) as { seasons: SeasonAudit[] }).seasons
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to load'
    } finally {
      loading = false
    }
  }

  onMount(load)

  const blockingCount = $derived(
    (audits ?? []).reduce((n, s) => n + s.issues.filter((i) => i.level === 'blocking').length, 0)
  )
</script>

<section class="admin-bordered p-3">
  <div class="mb-3 flex items-center justify-between gap-2">
    <div
      class="text-sm font-semibold tracking-wide uppercase"
      style="color: rgba(255,255,255,0.8);"
    >
      Past season backfill check
      {#if audits && blockingCount > 0}
        <span class="ml-2 text-xs normal-case" style="color: rgb(251,191,36);">
          {blockingCount} gap{blockingCount === 1 ? '' : 's'} affecting placements
        </span>
      {/if}
    </div>
    <button
      type="button"
      class="admin-btn text-xs"
      onclick={load}
      disabled={loading}
      aria-label="Re-run backfill check"
    >
      <RefreshCw size={13} class={loading ? 'animate-spin' : ''} />
    </button>
  </div>

  {#if loadError}
    <p class="text-sm" style="color: rgb(248,113,113);">{loadError}</p>
  {:else if !audits}
    <p class="text-sm" style="color: rgba(255,255,255,0.6);">Checking past seasons…</p>
  {:else if audits.length === 0}
    <p class="text-sm" style="color: rgba(255,255,255,0.6);">No past seasons yet.</p>
  {:else}
    <div class="grid grid-cols-1 gap-2">
      {#each audits as season (season.id)}
        <div
          class="rounded-md border px-3 py-2"
          style="border-color: rgba(255,255,255,0.08); background: rgba(0,0,0,0.14);"
        >
          <div class="flex items-center gap-2 text-sm font-medium" style="color: #fff;">
            {#if season.issues.some((i) => i.level === 'blocking')}
              <AlertTriangle size={14} style="color: rgb(251,191,36);" />
            {:else}
              <CheckCircle2 size={14} style="color: rgb(74,222,128);" />
            {/if}
            {season.name}
            {#if season.kind === 'external'}
              <span class="text-xs" style="color: rgba(255,255,255,0.45);">external</span>
            {/if}
          </div>
          {#if season.issues.length === 0}
            <p class="mt-1 text-xs" style="color: rgba(255,255,255,0.55);">Nothing missing.</p>
          {:else}
            <ul class="mt-1 grid gap-0.5 text-xs">
              {#each season.issues as issue, i (i)}
                <li
                  style="color: {issue.level === 'blocking'
                    ? 'rgb(251,191,36)'
                    : 'rgba(255,255,255,0.6)'};"
                >
                  {issue.message}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>
