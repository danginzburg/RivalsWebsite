<script lang="ts">
  import type { PageProps } from './$types'
  import StatsImport from '$lib/components/admin/StatsImport.svelte'
  import { Save } from 'lucide-svelte'

  let { data }: PageProps = $props()

  const batches = $derived(data.batches ?? [])

  let orderById = $state<Record<string, string>>({})
  let savingId = $state<string | null>(null)
  let message = $state<string | null>(null)

  $effect(() => {
    const next: Record<string, string> = {}
    for (const b of batches) {
      next[b.id] = b.sort_order === null || b.sort_order === undefined ? '' : String(b.sort_order)
    }
    orderById = next
  })

  async function saveOrder(batchId: string) {
    savingId = batchId
    message = null
    try {
      const sortOrder = orderById[batchId] ?? ''
      const res = await window.fetch(`/api/admin/stats/batches/${batchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.message ?? 'Failed to save order')
      message = 'Saved.'
      window.location.reload()
    } catch (err) {
      message = err instanceof Error ? err.message : 'Failed to save order'
    } finally {
      savingId = null
    }
  }

  function shortId(id: string) {
    return id.slice(0, 8)
  }
</script>

<StatsImport {data} />

<div class="flex justify-center px-4 pb-10">
  <div class="w-full max-w-6xl">
    <section
      class="mt-6 rounded-lg border p-4"
      style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
    >
      <div class="mb-2 text-sm font-semibold" style="color: rgba(255,255,255,0.9);">
        Batch Ordering
      </div>
      <div class="text-xs" style="color: rgba(255,255,255,0.7);">
        Set a numeric order to control how batches appear in dropdowns. Lower numbers appear first.
        Leave blank to fall back to the default ordering.
      </div>

      {#if message}
        <div class="mt-3 text-sm" style="color: rgba(255,255,255,0.85);">{message}</div>
      {/if}

      <div class="mt-4 overflow-x-auto">
        <table class="min-w-full text-left text-sm">
          <thead>
            <tr class="text-xs tracking-wide uppercase" style="color: rgba(255,255,255,0.75);">
              <th class="px-3 py-2">Order</th>
              <th class="px-3 py-2">Name</th>
              <th class="px-3 py-2">Kind</th>
              <th class="px-3 py-2">Week</th>
              <th class="px-3 py-2">Created</th>
              <th class="px-3 py-2">ID</th>
              <th class="px-3 py-2">Save</th>
            </tr>
          </thead>
          <tbody>
            {#each batches as b}
              <tr class="border-t" style="border-color: rgba(255,255,255,0.10);">
                <td class="px-3 py-2">
                  <input
                    class="w-24 rounded-md border px-2 py-1 text-sm"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                    placeholder="(auto)"
                    bind:value={orderById[b.id]}
                  />
                </td>
                <td class="px-3 py-2" style="color: rgba(255,255,255,0.9);">{b.display_name}</td>
                <td class="px-3 py-2" style="color: rgba(255,255,255,0.8);"
                  >{b.import_kind ?? '—'}</td
                >
                <td class="px-3 py-2" style="color: rgba(255,255,255,0.8);"
                  >{b.week_label ?? '—'}</td
                >
                <td class="px-3 py-2" style="color: rgba(255,255,255,0.8);">
                  {b.created_at
                    ? new Date(b.created_at).toLocaleString(undefined, { timeZone: 'UTC' })
                    : '—'}
                </td>
                <td
                  class="px-3 py-2"
                  style="color: rgba(255,255,255,0.75); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"
                >
                  {shortId(b.id)}
                </td>
                <td class="px-3 py-2">
                  <button
                    type="button"
                    class="inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold"
                    style="background: rgba(59,130,246,0.16); color: #93c5fd;"
                    onclick={() => saveOrder(b.id)}
                    disabled={savingId === b.id}
                  >
                    <Save size={14} />
                    {savingId === b.id ? 'Saving...' : 'Save'}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  </div>
</div>
