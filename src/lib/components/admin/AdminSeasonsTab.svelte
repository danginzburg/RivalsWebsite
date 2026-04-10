<script lang="ts">
  interface Props {
    seasons: any[]
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
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>
