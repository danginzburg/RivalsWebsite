<script lang="ts">
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { Upload, Plus, X } from 'lucide-svelte'
  import type { AdminSeason, SeasonEditState, SeasonTeamEntry } from '$lib/admin/types'
  import {
    SEASON_SECTION_KEYS,
    SEASON_SECTION_LABELS,
    allSectionsOn,
    type SeasonExternalLink,
    type SeasonKind,
    type SeasonSectionKey,
  } from '$lib/seasons/profile'

  const kindOptions = [
    { value: 'rivals', label: 'Rivals' },
    { value: 'external', label: 'External' },
  ]

  interface Props {
    seasons: AdminSeason[]
    /**
     * Approved teams from every season. The dashboard's `approvedTeams` follows
     * the global season picker, so it cannot answer "which teams played in the
     * season on this row" — that is what the per-season pickers here need.
     */
    seasonTeams?: SeasonTeamEntry[]
    /** Candidates for the season MVP picker. */
    players?: Array<{
      id: string
      display_name: string | null
      riot_id_base: string | null
      email: string | null
    }>
    /** Leaderboard imports that can be pinned as a season's final standings. */
    leaderboardBatches?: Array<{ id: string; label: string }>
    /** Every Valorant map + art, for the per-season map-pool picker. */
    valorantMaps?: Array<{ displayName: string; listViewIcon: string }>
    createSeasonCode: string
    createSeasonName: string
    createSeasonKind: SeasonKind
    createSeasonStartsOn: string
    createSeasonEndsOn: string
    createSeasonIsActive: boolean
    isCreatingSeason: boolean
    seasonEditForm: Record<string, SeasonEditState>
    onCreateSeasonCodeChange: (value: string) => void
    onCreateSeasonNameChange: (value: string) => void
    onCreateSeasonKindChange: (value: SeasonKind) => void
    onCreateSeasonStartsOnChange: (value: string) => void
    onCreateSeasonEndsOnChange: (value: string) => void
    onCreateSeasonIsActiveChange: (value: boolean) => void
    onSeasonEditChange: (seasonId: string, nextState: SeasonEditState) => void
    onCreateSeason: () => void
    onSaveSeason: (seasonId: string) => void
    /** Season id whose logo is mid-upload, or null. */
    logoUploadingSeasonId?: string | null
    onUploadSeasonLogo: (seasonId: string, file: File) => void
    onRemoveSeasonLogo: (seasonId: string, seasonName: string) => void
    /** Season id whose standings CSV is mid-upload, or null. */
    leaderboardUploadingSeasonId?: string | null
    /** Imports a standings CSV and pins it as this season's snapshot. */
    onUploadLeaderboardCsv: (seasonId: string, file: File) => void
  }

  let {
    seasons,
    seasonTeams = [],
    players = [],
    leaderboardBatches = [],
    valorantMaps = [],
    createSeasonCode,
    createSeasonName,
    createSeasonKind,
    createSeasonStartsOn,
    createSeasonEndsOn,
    createSeasonIsActive,
    isCreatingSeason,
    seasonEditForm,
    onCreateSeasonCodeChange,
    onCreateSeasonNameChange,
    onCreateSeasonKindChange,
    onCreateSeasonStartsOnChange,
    onCreateSeasonEndsOnChange,
    onCreateSeasonIsActiveChange,
    onSeasonEditChange,
    onCreateSeason,
    onSaveSeason,
    logoUploadingSeasonId = null,
    onUploadSeasonLogo,
    onRemoveSeasonLogo,
    leaderboardUploadingSeasonId = null,
    onUploadLeaderboardCsv,
  }: Props = $props()

  let expandedResultsSeasonId = $state<string | null>(null)

  const teamLabel = (team: { name: string; tag: string | null }) =>
    team.name + (team.tag ? ` (${team.tag})` : '')

  /**
   * Only the teams that played in that season — a champion or seed from another
   * season is never a valid answer. A season with nothing filed against it yet
   * gets an empty picker rather than a borrowed list, because silently offering
   * another season's teams is the bug this scoping exists to prevent.
   */
  function teamsForSeason(seasonId: string) {
    return seasonTeams.filter((t) => t.season_id === seasonId)
  }

  /** Blank option lets an admin clear a previously-set result. */
  function teamPickerOptions(seasonId: string) {
    return [
      { value: '', label: '— None —' },
      ...teamsForSeason(seasonId).map((t) => ({ value: t.id, label: teamLabel(t) })),
    ]
  }

  const playerPickerOptions = $derived([
    { value: '', label: '— None —' },
    ...(players ?? []).map((p) => ({
      value: p.id,
      label: p.display_name ?? p.riot_id_base ?? p.email ?? 'Player',
    })),
  ])

  const leaderboardBatchOptions = $derived([
    { value: '', label: '— Use latest import —' },
    ...(leaderboardBatches ?? []).map((b) => ({ value: b.id, label: b.label })),
  ])

  /** Add or remove a map from a season's pool, keeping selection order. */
  function toggleMapInPool(pool: string[], mapName: string): string[] {
    return pool.includes(mapName) ? pool.filter((m) => m !== mapName) : [...pool, mapName]
  }

  /** Sections default to all-on for any season saved before this field existed. */
  function sectionsOf(state: SeasonEditState): Record<SeasonSectionKey, boolean> {
    return state.sections ?? allSectionsOn()
  }

  function toggleSection(
    state: SeasonEditState,
    key: SeasonSectionKey,
    on: boolean
  ): Record<SeasonSectionKey, boolean> {
    return { ...sectionsOf(state), [key]: on }
  }

  function updateLink(
    links: SeasonExternalLink[],
    index: number,
    patch: Partial<SeasonExternalLink>
  ): SeasonExternalLink[] {
    return links.map((link, i) => (i === index ? { ...link, ...patch } : link))
  }
</script>

<div class="grid grid-cols-1 gap-4">
  <section class="admin-bordered p-3">
    <div
      class="mb-3 text-sm font-semibold tracking-wide uppercase"
      style="color: rgba(255,255,255,0.8);"
    >
      Create Season
    </div>
    <div class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-6">
      <input
        bind:value={createSeasonCode}
        oninput={(e) => onCreateSeasonCodeChange((e.currentTarget as HTMLInputElement).value)}
        class="admin-input"
        placeholder="Code (e.g. S1)"
      />
      <input
        bind:value={createSeasonName}
        oninput={(e) => onCreateSeasonNameChange((e.currentTarget as HTMLInputElement).value)}
        class="admin-input xl:col-span-2"
        placeholder="Season name"
      />
      <CustomSelect
        options={kindOptions}
        value={createSeasonKind}
        compact={true}
        onSelect={(value) => onCreateSeasonKindChange(value === 'external' ? 'external' : 'rivals')}
      />
      <input
        type="date"
        bind:value={createSeasonStartsOn}
        oninput={(e) => onCreateSeasonStartsOnChange((e.currentTarget as HTMLInputElement).value)}
        class="admin-input"
      />
      <input
        type="date"
        bind:value={createSeasonEndsOn}
        oninput={(e) => onCreateSeasonEndsOnChange((e.currentTarget as HTMLInputElement).value)}
        class="admin-input"
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
        class="admin-btn admin-btn-go text-sm"
        onclick={onCreateSeason}
        disabled={isCreatingSeason}
      >
        {isCreatingSeason ? 'Creating...' : 'Create Season'}
      </button>
    </div>
  </section>

  <section class="admin-bordered p-3">
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
            kind: (season.kind === 'external' ? 'external' : 'rivals') as SeasonKind,
            startsOn: season.starts_on ?? '',
            endsOn: season.ends_on ?? '',
            isActive: Boolean(season.is_active),
            summary: season.summary ?? '',
            winnerTeamId: season.winner_team_id ?? '',
            runnerUpTeamId: season.runner_up_team_id ?? '',
            mvpProfileId: season.mvp_profile_id ?? '',
            finalLeaderboardBatchId: season.final_leaderboard_batch_id ?? '',
            mapPool: Array.isArray(season.metadata?.map_pool)
              ? (season.metadata.map_pool as unknown[]).filter(
                  (name): name is string => typeof name === 'string'
                )
              : [],
            sections: allSectionsOn(),
            links: [],
          }}
          {@const isResultsExpanded = expandedResultsSeasonId === season.id}
          <article
            class="rounded-md border p-3"
            style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
          >
            <div class="mb-2 flex items-center justify-between gap-2">
              <div class="flex min-w-0 items-center gap-2">
                {#if season.logo_url}
                  <img
                    src={season.logo_url}
                    alt="{season.name} logo"
                    class="h-8 w-8 flex-shrink-0 rounded object-contain"
                    style="background: rgba(255,255,255,0.04);"
                  />
                {:else}
                  <div
                    class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded text-[9px] font-bold"
                    style="background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.56);"
                  >
                    {season.code?.slice(0, 3).toUpperCase() ?? '—'}
                  </div>
                {/if}
                <div class="truncate font-semibold" style="color: var(--text);">{season.name}</div>
              </div>
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
                class="admin-input"
              />
              <input
                value={state.name}
                oninput={(e) =>
                  onSeasonEditChange(season.id, {
                    ...state,
                    name: (e.currentTarget as HTMLInputElement).value,
                  })}
                class="admin-input xl:col-span-2"
              />
              <input
                type="date"
                value={state.startsOn}
                oninput={(e) =>
                  onSeasonEditChange(season.id, {
                    ...state,
                    startsOn: (e.currentTarget as HTMLInputElement).value,
                  })}
                class="admin-input"
              />
              <input
                type="date"
                value={state.endsOn}
                oninput={(e) =>
                  onSeasonEditChange(season.id, {
                    ...state,
                    endsOn: (e.currentTarget as HTMLInputElement).value,
                  })}
                class="admin-input"
              />
            </div>
            <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div class="flex flex-wrap items-center gap-3">
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
                <label
                  class="inline-flex items-center gap-2 text-sm"
                  style="color: rgba(255,255,255,0.82);"
                >
                  Type
                  <div style="min-width: 130px;">
                    <CustomSelect
                      options={kindOptions}
                      value={state.kind}
                      compact={true}
                      onSelect={(value) =>
                        onSeasonEditChange(season.id, {
                          ...state,
                          kind: value === 'external' ? 'external' : 'rivals',
                        })}
                    />
                  </div>
                </label>
              </div>
              <button
                type="button"
                class="admin-btn admin-btn-info text-sm"
                onclick={() => onSaveSeason(season.id)}
              >
                Save Season
              </button>
            </div>

            <!-- Season results — feeds /events and the Hall of Fame -->
            <div
              class="mt-3 rounded-md border"
              style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.03);"
            >
              <button
                type="button"
                class="flex w-full items-center gap-2 p-3"
                style="cursor: pointer;"
                onclick={() => (expandedResultsSeasonId = isResultsExpanded ? null : season.id)}
              >
                <span
                  class="inline-block text-xs"
                  style="color: rgba(255,255,255,0.5); transform: rotate({isResultsExpanded
                    ? '90deg'
                    : '0deg'});">▶</span
                >
                <div class="text-left">
                  <div class="text-sm font-semibold" style="color: var(--text);">
                    Season Results
                  </div>
                  <div class="text-xs" style="color: rgba(255,255,255,0.62);">
                    Champion, MVP, and summary shown on the Events page
                    {#if season.winner_team_id}
                      <span style="color: #fcd34d;"> · Champion set</span>
                    {/if}
                  </div>
                </div>
              </button>

              {#if isResultsExpanded}
                <div class="px-3 pb-3">
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                      Champion
                      <div class="mt-1">
                        <CustomSelect
                          options={teamPickerOptions(season.id)}
                          value={state.winnerTeamId}
                          compact={true}
                          placeholder="No champion set"
                          onSelect={(value) =>
                            onSeasonEditChange(season.id, { ...state, winnerTeamId: value })}
                        />
                      </div>
                    </label>
                    <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                      Runner-up
                      <div class="mt-1">
                        <CustomSelect
                          options={teamPickerOptions(season.id)}
                          value={state.runnerUpTeamId}
                          compact={true}
                          placeholder="No runner-up set"
                          onSelect={(value) =>
                            onSeasonEditChange(season.id, { ...state, runnerUpTeamId: value })}
                        />
                      </div>
                    </label>
                    <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                      MVP
                      <div class="mt-1">
                        <CustomSelect
                          options={playerPickerOptions}
                          value={state.mvpProfileId}
                          compact={true}
                          placeholder="No MVP set"
                          onSelect={(value) =>
                            onSeasonEditChange(season.id, { ...state, mvpProfileId: value })}
                        />
                      </div>
                    </label>
                  </div>

                  <label class="mt-2 block text-xs" style="color: rgba(255,255,255,0.82);">
                    Final Standings Snapshot
                    <div class="mt-1">
                      <CustomSelect
                        options={leaderboardBatchOptions}
                        value={state.finalLeaderboardBatchId}
                        compact={true}
                        placeholder="Use latest leaderboard import"
                        onSelect={(value) =>
                          onSeasonEditChange(season.id, {
                            ...state,
                            finalLeaderboardBatchId: value,
                          })}
                      />
                    </div>
                  </label>

                  <div class="mt-2 flex flex-wrap items-center gap-2">
                    <label
                      class="admin-inline-upload"
                      class:admin-inline-upload-busy={leaderboardUploadingSeasonId === season.id}
                    >
                      <Upload size={13} />
                      <span>
                        {leaderboardUploadingSeasonId === season.id
                          ? 'Importing…'
                          : 'Upload standings CSV'}
                      </span>
                      <input
                        type="file"
                        accept=".csv"
                        class="hidden"
                        disabled={leaderboardUploadingSeasonId === season.id}
                        onchange={(event) => {
                          const input = event.currentTarget as HTMLInputElement
                          const file = input.files?.[0]
                          // Cleared so re-picking the same file fires onchange again.
                          input.value = ''
                          if (file) onUploadLeaderboardCsv(season.id, file)
                        }}
                      />
                    </label>
                    <span class="text-xs" style="color: rgba(255,255,255,0.5);">
                      Imports for {season.name} and selects it above — still needs Save.
                    </span>
                  </div>

                  <div class="admin-bordered mt-2 p-2">
                    <div class="mb-2 text-xs font-semibold" style="color: rgba(255,255,255,0.82);">
                      Season Logo
                    </div>
                    <div class="flex flex-wrap items-center gap-3">
                      {#if season.logo_url}
                        <img
                          src={season.logo_url}
                          alt="{season.name} logo"
                          class="h-12 w-12 rounded object-contain"
                          style="background: rgba(255,255,255,0.04);"
                        />
                      {:else}
                        <div
                          class="flex h-12 w-12 items-center justify-center rounded text-[10px]"
                          style="background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.56);"
                        >
                          None
                        </div>
                      {/if}
                      <input
                        type="file"
                        accept="image/*"
                        class="admin-input flex-1"
                        disabled={logoUploadingSeasonId === season.id}
                        onchange={(e) => {
                          const file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null
                          if (file) onUploadSeasonLogo(season.id, file)
                          ;(e.currentTarget as HTMLInputElement).value = ''
                        }}
                      />
                      {#if season.logo_url}
                        <button
                          type="button"
                          class="admin-btn admin-btn-sm admin-btn-danger"
                          disabled={logoUploadingSeasonId === season.id}
                          onclick={() => onRemoveSeasonLogo(season.id, season.name)}
                        >
                          Remove
                        </button>
                      {/if}
                    </div>
                    {#if logoUploadingSeasonId === season.id}
                      <div class="mt-1 text-[11px]" style="color: rgba(255,255,255,0.5);">
                        Uploading...
                      </div>
                    {/if}
                  </div>

                  <label class="mt-2 block text-xs" style="color: rgba(255,255,255,0.82);">
                    Summary
                    <textarea
                      rows="3"
                      value={state.summary}
                      class="admin-input mt-1 leading-5"
                      placeholder="A short recap shown on the season card and detail page."
                      oninput={(e) =>
                        onSeasonEditChange(season.id, {
                          ...state,
                          summary: (e.currentTarget as HTMLTextAreaElement).value,
                        })}
                    ></textarea>
                  </label>

                  <div class="admin-bordered mt-2 p-2">
                    <div
                      class="mb-2 flex items-center gap-2 text-xs font-semibold"
                      style="color: rgba(255,255,255,0.82);"
                    >
                      Map Pool
                      <span style="color: rgba(255,255,255,0.5);">
                        {state.mapPool.length} selected
                      </span>
                    </div>
                    {#if valorantMaps.length === 0}
                      <div class="text-xs" style="color: rgba(255,255,255,0.5);">
                        Map art is unavailable right now — reload to try again.
                      </div>
                    {:else}
                      <div class="map-pool-grid">
                        {#each valorantMaps as map (map.displayName)}
                          {@const selected = state.mapPool.includes(map.displayName)}
                          <button
                            type="button"
                            class="map-pool-chip"
                            class:map-pool-chip-on={selected}
                            aria-pressed={selected}
                            onclick={() =>
                              onSeasonEditChange(season.id, {
                                ...state,
                                mapPool: toggleMapInPool(state.mapPool, map.displayName),
                              })}
                          >
                            <img src={map.listViewIcon} alt="" class="map-pool-art" />
                            <span class="map-pool-name">{map.displayName}</span>
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>

                  <!-- Event page profile: which sections show + outbound links.
                       Most useful for external events that host their rulebook /
                       signup / FAQ elsewhere and don't run a full bracket. -->
                  <div class="admin-bordered mt-2 p-2">
                    <div class="mb-2 text-xs font-semibold" style="color: rgba(255,255,255,0.82);">
                      Event Page Sections
                    </div>
                    <div class="flex flex-wrap gap-x-4 gap-y-2">
                      {#each SEASON_SECTION_KEYS as key (key)}
                        <label
                          class="inline-flex items-center gap-2 text-xs"
                          style="color: rgba(255,255,255,0.82);"
                        >
                          <input
                            type="checkbox"
                            checked={sectionsOf(state)[key]}
                            onchange={(e) =>
                              onSeasonEditChange(season.id, {
                                ...state,
                                sections: toggleSection(
                                  state,
                                  key,
                                  (e.currentTarget as HTMLInputElement).checked
                                ),
                              })}
                          />
                          {SEASON_SECTION_LABELS[key]}
                        </label>
                      {/each}
                    </div>

                    <div
                      class="mt-3 mb-2 flex items-center gap-2 text-xs font-semibold"
                      style="color: rgba(255,255,255,0.82);"
                    >
                      External Links
                      <span style="color: rgba(255,255,255,0.5);">
                        Rulebook / signup / FAQ hosted elsewhere
                      </span>
                    </div>
                    <div class="flex flex-col gap-2">
                      {#each state.links ?? [] as link, i (i)}
                        <div class="flex flex-wrap items-center gap-2">
                          <input
                            value={link.label}
                            class="admin-input"
                            style="max-width: 160px;"
                            placeholder="Label (e.g. Rulebook)"
                            oninput={(e) =>
                              onSeasonEditChange(season.id, {
                                ...state,
                                links: updateLink(state.links, i, {
                                  label: (e.currentTarget as HTMLInputElement).value,
                                }),
                              })}
                          />
                          <input
                            value={link.url}
                            class="admin-input flex-1"
                            style="min-width: 200px;"
                            placeholder="https://…"
                            oninput={(e) =>
                              onSeasonEditChange(season.id, {
                                ...state,
                                links: updateLink(state.links, i, {
                                  url: (e.currentTarget as HTMLInputElement).value,
                                }),
                              })}
                          />
                          <button
                            type="button"
                            class="admin-btn admin-btn-sm admin-btn-danger"
                            aria-label="Remove link"
                            onclick={() =>
                              onSeasonEditChange(season.id, {
                                ...state,
                                links: state.links.filter((_, idx) => idx !== i),
                              })}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      {/each}
                      <div>
                        <button
                          type="button"
                          class="admin-btn admin-btn-sm admin-btn-neutral inline-flex items-center gap-1"
                          onclick={() =>
                            onSeasonEditChange(season.id, {
                              ...state,
                              links: [...(state.links ?? []), { label: '', url: '' }],
                            })}
                        >
                          <Plus size={13} /> Add link
                        </button>
                      </div>
                    </div>
                  </div>

                  <div class="mt-2 flex justify-end">
                    <button
                      type="button"
                      class="admin-btn admin-btn-sm admin-btn-info"
                      onclick={() => onSaveSeason(season.id)}
                    >
                      Save Results
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .map-pool-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 0.375rem;
  }

  .map-pool-chip {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: 0.375rem;
    overflow: hidden;
    border: 2px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.3);
    cursor: pointer;
    padding: 0;
    opacity: 0.55;
    transition:
      opacity 0.15s,
      border-color 0.15s;
  }

  .map-pool-chip:hover {
    opacity: 0.85;
  }

  .map-pool-chip-on {
    opacity: 1;
    border-color: #86efac;
  }

  .map-pool-art {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .map-pool-name {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 0.5rem 0.375rem 0.3125rem;
    font-size: 0.6875rem;
    font-weight: 700;
    color: #fff;
    text-align: left;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0));
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
  }
</style>
