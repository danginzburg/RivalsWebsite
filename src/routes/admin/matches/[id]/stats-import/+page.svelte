<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Upload, Swords } from 'lucide-svelte'

  let { data }: PageProps = $props()

  const match = $derived(data.match)
  const existingMaps = $derived(data.existingMaps ?? [])

  let mapOrder = $state('1')
  let mapName = $state('')
  let teamARounds = $state('')
  let teamBRounds = $state('')

  let file: File | null = $state(null)
  let clientError = $state<string | null>(null)

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }

  function handleFileInput(e: Event) {
    clientError = null
    const f = (e.currentTarget as HTMLInputElement).files?.[0] ?? null
    if (f && !f.name.toLowerCase().endsWith('.csv')) {
      clientError = 'Please choose a .csv file'
      file = null
      return
    }
    file = f
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-4xl">
      <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <Swords size={36} style="color: var(--text);" />
          <div>
            <h1 class="responsive-title">Import Map Stats</h1>
            <p class="text-sm" style="color: rgba(255,255,255,0.72);">
              {teamName(match.team_a)} vs {teamName(match.team_b)} • Match {match.id}
            </p>
          </div>
        </div>
        <a
          href="/admin"
          class="rounded-md px-3 py-2 text-xs font-semibold"
          style="background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.85);"
        >
          Back to Admin
        </a>
      </div>

      <section
        class="rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <h2
          class="mb-3 text-sm font-semibold tracking-wide uppercase"
          style="color: rgba(255,255,255,0.8);"
        >
          Upload One Map CSV
        </h2>

        {#if clientError}
          <div
            class="mb-3 rounded-md border p-3 text-sm"
            style="border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); color: #fecaca;"
          >
            {clientError}
          </div>
        {/if}

        <form method="POST" enctype="multipart/form-data" class="space-y-3">
          <div class="grid grid-cols-1 gap-2 md:grid-cols-4">
            <div>
              <label
                for="map-order"
                class="mb-1 block text-xs font-semibold"
                style="color: rgba(255,255,255,0.75);"
              >
                Map #
              </label>
              <input
                id="map-order"
                name="mapOrder"
                type="number"
                min="1"
                bind:value={mapOrder}
                class="w-full rounded-md border px-3 py-2 text-sm"
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              />
            </div>
            <div>
              <label
                for="map-name"
                class="mb-1 block text-xs font-semibold"
                style="color: rgba(255,255,255,0.75);"
              >
                Map Name (optional)
              </label>
              <input
                id="map-name"
                name="mapName"
                type="text"
                bind:value={mapName}
                class="w-full rounded-md border px-3 py-2 text-sm"
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                placeholder="Ascent, Haven, ..."
              />
            </div>
            <div>
              <label
                for="team-a-rounds"
                class="mb-1 block text-xs font-semibold"
                style="color: rgba(255,255,255,0.75);"
              >
                {teamName(match.team_a)} rounds
              </label>
              <input
                id="team-a-rounds"
                name="teamARounds"
                type="number"
                min="0"
                bind:value={teamARounds}
                class="w-full rounded-md border px-3 py-2 text-sm"
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              />
            </div>
            <div>
              <label
                for="team-b-rounds"
                class="mb-1 block text-xs font-semibold"
                style="color: rgba(255,255,255,0.75);"
              >
                {teamName(match.team_b)} rounds
              </label>
              <input
                id="team-b-rounds"
                name="teamBRounds"
                type="number"
                min="0"
                bind:value={teamBRounds}
                class="w-full rounded-md border px-3 py-2 text-sm"
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              />
            </div>
          </div>

          <div>
            <label
              for="map-csv"
              class="mb-1 block text-xs font-semibold"
              style="color: rgba(255,255,255,0.75);"
            >
              CSV File
            </label>
            <input
              id="map-csv"
              name="csv"
              type="file"
              accept=".csv,text/csv"
              class="w-full rounded-md border px-3 py-2 text-sm"
              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              oninput={handleFileInput}
              required
            />
          </div>

          <button
            type="submit"
            formaction="?/importMap"
            class="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
            style="background: rgba(74,222,128,0.2); color: #4ade80;"
            disabled={!file}
          >
            <Upload size={16} />
            Import Map
          </button>
        </form>
      </section>

      <section
        class="mt-4 rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <h2
          class="mb-3 text-sm font-semibold tracking-wide uppercase"
          style="color: rgba(255,255,255,0.8);"
        >
          Imported Maps ({existingMaps.length})
        </h2>

        {#if existingMaps.length === 0}
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">No map stats imported yet.</p>
        {:else}
          <div class="flex flex-col gap-2">
            {#each existingMaps as m}
              <div
                class="rounded-md border p-3 text-sm"
                style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18); color: var(--text);"
              >
                <strong>Map {m.map_order}</strong>
                {#if m.map_name}
                  <span class="opacity-80"> • {m.map_name}</span>
                {/if}
                {#if Number.isFinite(m.team_a_rounds) && Number.isFinite(m.team_b_rounds)}
                  <span class="opacity-80"> • {m.team_a_rounds}-{m.team_b_rounds}</span>
                {/if}
                {#if m.source_filename}
                  <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.65);">
                    {m.source_filename}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  </div>
</PageContainer>
