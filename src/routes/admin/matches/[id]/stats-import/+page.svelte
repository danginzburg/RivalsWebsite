<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Upload, Swords, ArrowLeft } from 'lucide-svelte'
  import { resolve } from '$app/paths'

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
  <div class="flex justify-center py-6 sm:py-8">
    <div class="w-full max-w-4xl">
      <header class="admin-import-head">
        <div class="flex min-w-0 items-center gap-3">
          <Swords size={30} style="color: rgba(255,255,255,0.72); flex-shrink: 0;" />
          <div class="min-w-0">
            <h1 class="admin-import-title">Import Map Stats</h1>
            <p class="admin-hint mt-1">
              {teamName(match.team_a)} vs {teamName(match.team_b)} • Match {match.id}
            </p>
          </div>
        </div>
        <a href={resolve('/admin')} class="admin-back-link">
          <ArrowLeft size={14} /> Admin
        </a>
      </header>

      <section class="admin-card admin-card-pad">
        <h2
          class="mb-3 text-sm font-semibold tracking-wide uppercase"
          style="color: rgba(255,255,255,0.8);"
        >
          Upload One Map CSV
        </h2>

        {#if clientError}
          <div class="admin-alert admin-alert-error mb-3">
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
                class="admin-input"
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
                class="admin-input"
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
                class="admin-input"
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
                class="admin-input"
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
              class="admin-file"
              oninput={handleFileInput}
              required
            />
          </div>

          <button
            type="submit"
            formaction="?/importMap"
            class="admin-btn admin-btn-go text-sm"
            disabled={!file}
          >
            <Upload size={16} />
            Import Map
          </button>
        </form>
      </section>

      <section class="admin-card admin-card-pad mt-4">
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
            {#each existingMaps as m (m.id)}
              <div class="admin-subcard p-3 text-sm">
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
