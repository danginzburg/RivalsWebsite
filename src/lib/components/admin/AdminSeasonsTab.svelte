<script lang="ts">
  import CustomSelect from '$lib/components/CustomSelect.svelte'

  interface Props {
    seasons: any[]
    leaderboardBatches: any[]
    createSeasonCode: string
    createSeasonName: string
    createSeasonStartsOn: string
    createSeasonEndsOn: string
    createSeasonIsActive: boolean
    isCreatingSeason: boolean
    seasonEditForm: Record<string, any>
    onCreateSeasonCodeChange: (value: string) => void
    onCreateSeasonNameChange: (value: string) => void
    onCreateSeasonStartsOnChange: (value: string) => void
    onCreateSeasonEndsOnChange: (value: string) => void
    onCreateSeasonIsActiveChange: (value: boolean) => void
    onSeasonEditChange: (seasonId: string, nextState: any) => void
    onCreateSeason: () => void
    onSaveSeason: (seasonId: string) => void
  }

  let {
    seasons,
    leaderboardBatches,
    createSeasonCode,
    createSeasonName,
    createSeasonStartsOn,
    createSeasonEndsOn,
    createSeasonIsActive,
    isCreatingSeason,
    seasonEditForm,
    onCreateSeasonCodeChange,
    onCreateSeasonNameChange,
    onCreateSeasonStartsOnChange,
    onCreateSeasonEndsOnChange,
    onCreateSeasonIsActiveChange,
    onSeasonEditChange,
    onCreateSeason,
    onSaveSeason,
  }: Props = $props()

  const pickemStatusOptions = [
    { value: 'draft', label: 'Draft' },
    { value: 'open', label: 'Open' },
    { value: 'locked', label: 'Locked' },
    { value: 'scored', label: 'Scored' },
  ]

  const baselineRoundOptions = [
    { value: '1', label: 'Week 1 Baseline' },
    { value: '2', label: 'Week 2 Baseline' },
  ]

  function getBatchMeta(batchId: string) {
    return leaderboardBatches.find((batch) => batch.id === batchId) ?? null
  }

  function getBatchOptions(seasonId: string) {
    return leaderboardBatches
      .filter((batch) => !batch.season_id || batch.season_id === seasonId)
      .map((batch) => ({
        value: batch.id,
        label: `${batch.display_name}${batch.as_of_date ? ` (${batch.as_of_date})` : ''}`,
      }))
  }

  function getPreviewRows(season: any) {
    return Array.isArray(season.pickem_preview_rows) ? season.pickem_preview_rows : []
  }

  type PreviewRow = { wins?: number; losses?: number }

  function baselineBucketCounts(totalRounds: number, rows: PreviewRow[]) {
    const total = Math.max(1, Math.floor(Number(totalRounds) || 2))
    return Array.from({ length: total + 1 }, (_, losses) => {
      const wins = total - losses
      const count = rows.filter((row) => row.wins === wins && row.losses === losses).length
      return { label: `${wins}-${losses}`, count }
    })
  }
</script>

<div class="grid grid-cols-1 gap-4">
  <section class="rounded-md border p-3" style="border-color: rgba(255,255,255,0.12);">
    <div
      class="mb-3 text-sm font-semibold tracking-wide uppercase"
      style="color: rgba(255,255,255,0.8);"
    >
      Create Season
    </div>
    <div class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
      <input
        bind:value={createSeasonCode}
        oninput={(e) => onCreateSeasonCodeChange((e.currentTarget as HTMLInputElement).value)}
        class="rounded-md border px-3 py-2 text-sm"
        style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
        placeholder="Code (e.g. S1)"
      />
      <input
        bind:value={createSeasonName}
        oninput={(e) => onCreateSeasonNameChange((e.currentTarget as HTMLInputElement).value)}
        class="rounded-md border px-3 py-2 text-sm xl:col-span-2"
        style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
        placeholder="Season name"
      />
      <input
        type="date"
        bind:value={createSeasonStartsOn}
        oninput={(e) => onCreateSeasonStartsOnChange((e.currentTarget as HTMLInputElement).value)}
        class="rounded-md border px-3 py-2 text-sm"
        style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
      />
      <input
        type="date"
        bind:value={createSeasonEndsOn}
        oninput={(e) => onCreateSeasonEndsOnChange((e.currentTarget as HTMLInputElement).value)}
        class="rounded-md border px-3 py-2 text-sm"
        style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
      />
    </div>
    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
      <label class="inline-flex items-center gap-2 text-sm" style="color: rgba(255,255,255,0.82);">
        <input
          type="checkbox"
          checked={createSeasonIsActive}
          onchange={(e) =>
            onCreateSeasonIsActiveChange((e.currentTarget as HTMLInputElement).checked)}
        />
        Active season
      </label>
      <button
        type="button"
        class="rounded-md px-3 py-2 text-sm font-semibold"
        style="background: rgba(74,222,128,0.18); color: #86efac;"
        onclick={onCreateSeason}
        disabled={isCreatingSeason}
      >
        {isCreatingSeason ? 'Creating...' : 'Create Season'}
      </button>
    </div>
  </section>

  <section class="rounded-md border p-3" style="border-color: rgba(255,255,255,0.12);">
    <div
      class="mb-3 text-sm font-semibold tracking-wide uppercase"
      style="color: rgba(255,255,255,0.8);"
    >
      Seasons ({seasons.length})
    </div>

    {#if seasons.length === 0}
      <div class="py-10 text-center text-sm" style="color: rgba(255,255,255,0.72);">
        No seasons found.
      </div>
    {:else}
      <div class="grid grid-cols-1 gap-3">
        {#each seasons as season (season.id)}
          {@const state = seasonEditForm[season.id] ?? {
            code: season.code ?? '',
            name: season.name ?? '',
            startsOn: season.starts_on ?? '',
            endsOn: season.ends_on ?? '',
            isActive: Boolean(season.is_active),
          }}
          <article
            class="rounded-md border p-3"
            style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
          >
            <div class="mb-2 flex items-center justify-between gap-2">
              <div class="font-semibold" style="color: var(--text);">{season.name}</div>
              {#if season.is_active}
                <span
                  class="rounded-full px-2 py-1 text-xs font-bold"
                  style="background: rgba(74,222,128,0.18); color: #86efac;"
                >
                  Active
                </span>
              {/if}
            </div>
            <div class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
              <input
                value={state.code}
                oninput={(e) =>
                  onSeasonEditChange(season.id, {
                    ...state,
                    code: (e.currentTarget as HTMLInputElement).value,
                  })}
                class="rounded-md border px-3 py-2 text-sm"
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              />
              <input
                value={state.name}
                oninput={(e) =>
                  onSeasonEditChange(season.id, {
                    ...state,
                    name: (e.currentTarget as HTMLInputElement).value,
                  })}
                class="rounded-md border px-3 py-2 text-sm xl:col-span-2"
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              />
              <input
                type="date"
                value={state.startsOn}
                oninput={(e) =>
                  onSeasonEditChange(season.id, {
                    ...state,
                    startsOn: (e.currentTarget as HTMLInputElement).value,
                  })}
                class="rounded-md border px-3 py-2 text-sm"
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              />
              <input
                type="date"
                value={state.endsOn}
                oninput={(e) =>
                  onSeasonEditChange(season.id, {
                    ...state,
                    endsOn: (e.currentTarget as HTMLInputElement).value,
                  })}
                class="rounded-md border px-3 py-2 text-sm"
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              />
            </div>
            <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
              <label
                class="inline-flex items-center gap-2 text-sm"
                style="color: rgba(255,255,255,0.82);"
              >
                <input
                  type="checkbox"
                  checked={state.isActive}
                  onchange={(e) =>
                    onSeasonEditChange(season.id, {
                      ...state,
                      isActive: (e.currentTarget as HTMLInputElement).checked,
                    })}
                />
                Active season
              </label>
              <button
                type="button"
                class="rounded-md px-3 py-2 text-sm font-semibold"
                style="background: rgba(59,130,246,0.18); color: #93c5fd;"
                onclick={() => onSaveSeason(season.id)}
              >
                Save Season
              </button>
            </div>

            <div
              class="mt-4 rounded-md border p-3"
              style="border-color: rgba(147,197,253,0.18); background: rgba(59,130,246,0.06);"
            >
              <div
                class="mb-3 text-sm font-semibold tracking-wide uppercase"
                style="color: rgba(147,197,253,0.9);"
              >
                Bucket Pick'em
              </div>

              <div class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                <label
                  class="inline-flex items-center gap-2 text-sm"
                  style="color: rgba(255,255,255,0.82);"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(state.pickemEnabled)}
                    onchange={(e) =>
                      onSeasonEditChange(season.id, {
                        ...state,
                        pickemEnabled: (e.currentTarget as HTMLInputElement).checked,
                      })}
                  />
                  Enable bucket pick'em
                </label>

                <div>
                  <CustomSelect
                    options={baselineRoundOptions}
                    value={state.pickemBaselineCompletedRounds ?? '2'}
                    placeholder="Baseline"
                    compact={true}
                    onSelect={(value) =>
                      onSeasonEditChange(season.id, {
                        ...state,
                        pickemBaselineCompletedRounds: value,
                      })}
                  />
                </div>

                <div class="xl:col-span-2">
                  <CustomSelect
                    options={getBatchOptions(season.id)}
                    value={state.pickemLeaderboardBatchId ?? ''}
                    placeholder="Select leaderboard batch"
                    compact={true}
                    onSelect={(value) =>
                      onSeasonEditChange(season.id, {
                        ...state,
                        pickemLeaderboardBatchId: value,
                      })}
                  />
                </div>

                <CustomSelect
                  options={pickemStatusOptions}
                  value={state.pickemStatus ?? 'draft'}
                  placeholder="Status"
                  compact={true}
                  onSelect={(value) =>
                    onSeasonEditChange(season.id, {
                      ...state,
                      pickemStatus: value,
                    })}
                />
              </div>

              <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                <input
                  type="datetime-local"
                  value={state.pickemLockAt ?? ''}
                  oninput={(e) =>
                    onSeasonEditChange(season.id, {
                      ...state,
                      pickemLockAt: (e.currentTarget as HTMLInputElement).value,
                    })}
                  class="rounded-md border px-3 py-2 text-sm"
                  style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                />

                {#each [season.id] as _seasonKey (_seasonKey)}
                  {@const selectedBatch = getBatchMeta(state.pickemLeaderboardBatchId ?? '')}
                  <div
                    class="rounded-md border px-3 py-2 text-xs"
                    style="border-color: rgba(255,255,255,0.12); color: rgba(255,255,255,0.72);"
                  >
                    {#if selectedBatch}
                      Source batch: {selectedBatch.display_name}
                      {#if selectedBatch.as_of_date}
                        <span> • {selectedBatch.as_of_date}</span>
                      {/if}
                    {:else}
                      Select the leaderboard batch to freeze the 24-team field.
                    {/if}
                  </div>
                {/each}
              </div>

              {#if getPreviewRows(season).length > 0}
                <div
                  class="mt-3 rounded-md border p-3"
                  style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
                >
                  <div
                    class="flex flex-wrap items-center justify-between gap-2 text-sm"
                    style="color: var(--text);"
                  >
                    <strong>Frozen Baseline Preview</strong>
                    <span style="color: rgba(255,255,255,0.68);">
                      {getPreviewRows(season).length} teams
                    </span>
                  </div>
                  <div class="mt-2 flex flex-wrap gap-2 text-xs">
                    {#each baselineBucketCounts(Number(state.pickemBaselineCompletedRounds ?? '2'), getPreviewRows(season)) as cell}
                      <span
                        class="rounded-full px-2 py-1"
                        style="background: rgba(255,255,255,0.08); color: var(--text);"
                      >
                        {cell.label}: {cell.count}
                      </span>
                    {/each}
                  </div>
                  <p class="mt-2 text-xs" style="color: rgba(255,255,255,0.62);">
                    Zero round differential is valid here for FF or admin-decision results.
                  </p>
                </div>
              {/if}

              {#if season.pickem_preview_error}
                <p class="mt-3 text-sm" style="color: #fda4af;">{season.pickem_preview_error}</p>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>
