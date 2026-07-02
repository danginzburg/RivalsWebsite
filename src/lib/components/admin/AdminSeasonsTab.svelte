<script lang="ts">
  import { normalizePlayoffPickemConfig } from '$lib/playoffPickems'
  import type {
    AdminMatch,
    AdminSeason,
    ApprovedTeamEntry,
    SeasonEditState,
  } from '$lib/admin/types'

  interface Props {
    seasons: AdminSeason[]
    approvedTeams: ApprovedTeamEntry[]
    matches: AdminMatch[]
    createSeasonCode: string
    createSeasonName: string
    createSeasonStartsOn: string
    createSeasonEndsOn: string
    createSeasonIsActive: boolean
    isCreatingSeason: boolean
    seasonEditForm: Record<string, SeasonEditState>
    onCreateSeasonCodeChange: (value: string) => void
    onCreateSeasonNameChange: (value: string) => void
    onCreateSeasonStartsOnChange: (value: string) => void
    onCreateSeasonEndsOnChange: (value: string) => void
    onCreateSeasonIsActiveChange: (value: boolean) => void
    onSeasonEditChange: (seasonId: string, nextState: SeasonEditState) => void
    onCreateSeason: () => void
    onSaveSeason: (seasonId: string) => void
    onSavePlayoffPickem: (
      seasonId: string,
      config: ReturnType<typeof normalizePlayoffPickemConfig>
    ) => void
    onScorePlayoffPickem: (seasonId: string) => void
  }

  let {
    seasons,
    approvedTeams,
    matches,
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
    onSavePlayoffPickem,
    onScorePlayoffPickem,
  }: Props = $props()

  let playoffConfigForm = $state<Record<string, ReturnType<typeof normalizePlayoffPickemConfig>>>(
    {}
  )

  $effect(() => {
    const next: Record<string, ReturnType<typeof normalizePlayoffPickemConfig>> = {}
    for (const season of seasons ?? []) {
      next[season.id] =
        playoffConfigForm[season.id] ??
        normalizePlayoffPickemConfig(season.metadata?.playoff_pickem)
    }
    const keys = Object.keys(next)
    const currentKeys = Object.keys(playoffConfigForm)
    const changed =
      keys.length !== currentKeys.length ||
      keys.some(
        (key) => JSON.stringify(playoffConfigForm[key] ?? {}) !== JSON.stringify(next[key] ?? {})
      )
    if (changed) playoffConfigForm = next
  })

  function updatePlayoffConfig(
    seasonId: string,
    patch: Partial<ReturnType<typeof normalizePlayoffPickemConfig>>
  ) {
    const current = playoffConfigForm[seasonId] ?? normalizePlayoffPickemConfig(null)
    playoffConfigForm = {
      ...playoffConfigForm,
      [seasonId]: {
        ...current,
        ...patch,
      },
    }
  }

  function updateSeed(seasonId: string, seed: number, teamId: string) {
    const current = playoffConfigForm[seasonId] ?? normalizePlayoffPickemConfig(null)
    const seeds = current.seeds.filter((entry) => entry.seed !== seed)
    if (teamId) seeds.push({ seed, teamId })
    updatePlayoffConfig(seasonId, { seeds: seeds.sort((a, b) => a.seed - b.seed) })
  }

  function updateMatchLink(seasonId: string, matchId: string, actualMatchId: string) {
    const current = playoffConfigForm[seasonId] ?? normalizePlayoffPickemConfig(null)
    updatePlayoffConfig(seasonId, {
      match_links: current.match_links.map((link) =>
        link.matchId === matchId ? { ...link, actualMatchId: actualMatchId || null } : link
      ),
    })
  }

  function matchLabel(match: AdminMatch) {
    const a = Array.isArray(match.team_a) ? match.team_a[0] : match.team_a
    const b = Array.isArray(match.team_b) ? match.team_b[0] : match.team_b
    const names = `${a?.name ?? 'Team A'} vs ${b?.name ?? 'Team B'}`
    return match.scheduled_at
      ? `${names} - ${new Date(match.scheduled_at).toLocaleDateString()}`
      : names
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

            {#if true}
              {@const pickem = playoffConfigForm[season.id] ?? normalizePlayoffPickemConfig(null)}
              <div
                class="mt-4 rounded-md border p-3"
                style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.035);"
              >
                <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div class="text-sm font-semibold" style="color: var(--text);">
                      Playoff Pick'em
                    </div>
                    <div class="text-xs" style="color: rgba(255,255,255,0.62);">
                      8-team double elimination bracket
                    </div>
                  </div>
                  <label
                    class="inline-flex items-center gap-2 text-sm"
                    style="color: rgba(255,255,255,0.82);"
                  >
                    <input
                      type="checkbox"
                      checked={pickem.enabled}
                      onchange={(e) =>
                        updatePlayoffConfig(season.id, {
                          enabled: (e.currentTarget as HTMLInputElement).checked,
                        })}
                    />
                    Enabled
                  </label>
                </div>

                <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <select
                    value={pickem.status}
                    onchange={(e) =>
                      updatePlayoffConfig(season.id, {
                        status: (e.currentTarget as HTMLSelectElement)
                          .value as typeof pickem.status,
                      })}
                    class="rounded-md border px-3 py-2 text-sm"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                  >
                    <option value="draft">Draft</option>
                    <option value="open">Open</option>
                    <option value="locked">Locked</option>
                    <option value="scored">Scored</option>
                  </select>
                  <input
                    type="datetime-local"
                    value={pickem.lock_at ? pickem.lock_at.slice(0, 16) : ''}
                    oninput={(e) =>
                      updatePlayoffConfig(season.id, {
                        lock_at: (e.currentTarget as HTMLInputElement).value || null,
                      })}
                    class="rounded-md border px-3 py-2 text-sm md:col-span-2"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                  />
                </div>

                <div class="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
                  {#each [1, 2, 3, 4, 5, 6, 7, 8] as seed (seed)}
                    <label class="text-xs font-semibold" style="color: rgba(255,255,255,0.68);">
                      Seed {seed}
                      <select
                        value={pickem.seeds.find((entry) => entry.seed === seed)?.teamId ?? ''}
                        onchange={(e) =>
                          updateSeed(season.id, seed, (e.currentTarget as HTMLSelectElement).value)}
                        class="mt-1 w-full rounded-md border px-2 py-2 text-sm"
                        style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                      >
                        <option value="">Select team</option>
                        {#each approvedTeams as team (team.id)}
                          <option value={team.id}
                            >{team.name}{team.tag ? ` (${team.tag})` : ''}</option
                          >
                        {/each}
                      </select>
                    </label>
                  {/each}
                </div>

                <div class="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {#each pickem.match_links as link (link.matchId)}
                    <label class="text-xs font-semibold" style="color: rgba(255,255,255,0.68);">
                      {link.matchId}
                      <select
                        value={link.actualMatchId ?? ''}
                        onchange={(e) =>
                          updateMatchLink(
                            season.id,
                            link.matchId,
                            (e.currentTarget as HTMLSelectElement).value
                          )}
                        class="mt-1 w-full rounded-md border px-2 py-2 text-sm"
                        style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                      >
                        <option value="">No linked match</option>
                        {#each matches.filter((match) => match.team_a_id && match.team_b_id) as match (match.id)}
                          <option value={match.id}>{matchLabel(match)}</option>
                        {/each}
                      </select>
                    </label>
                  {/each}
                </div>

                <div class="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    class="rounded-md px-3 py-2 text-sm font-semibold"
                    style="background: rgba(59,130,246,0.18); color: #93c5fd;"
                    onclick={() => onSavePlayoffPickem(season.id, pickem)}
                  >
                    Save Pick'em
                  </button>
                  <button
                    type="button"
                    class="rounded-md px-3 py-2 text-sm font-semibold"
                    style="background: rgba(245,158,11,0.18); color: #fcd34d;"
                    onclick={() => onScorePlayoffPickem(season.id)}
                  >
                    Score Pick'em
                  </button>
                </div>
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>
