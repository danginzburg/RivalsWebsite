<script lang="ts">
  import {
    normalizePlayoffPickemConfig,
    PLAYOFF_MATCH_IDS,
    MATCH_LABELS,
    type PlayoffMatchId,
  } from '$lib/playoffPickems'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
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

  function updateMatchup(
    seasonId: string,
    matchId: string,
    side: 'seedA' | 'seedB',
    seedValue: string
  ) {
    const current = playoffConfigForm[seasonId] ?? normalizePlayoffPickemConfig(null)
    updatePlayoffConfig(seasonId, {
      matchups: current.matchups.map((mu) =>
        mu.matchId === matchId ? { ...mu, [side]: Number(seedValue) || mu[side] } : mu
      ),
    })
  }

  const seedOptions = Array.from({ length: 8 }, (_, i) => ({
    value: String(i + 1),
    label: `Seed ${i + 1}`,
  }))

  function updateMatchLink(seasonId: string, matchId: string, actualMatchId: string) {
    const current = playoffConfigForm[seasonId] ?? normalizePlayoffPickemConfig(null)
    updatePlayoffConfig(seasonId, {
      match_links: current.match_links.map((link) =>
        link.matchId === matchId ? { ...link, actualMatchId: actualMatchId || null } : link
      ),
    })
  }

  const pickemStatusOptions = [
    { value: 'draft', label: 'Draft' },
    { value: 'open', label: 'Open' },
    { value: 'locked', label: 'Locked' },
    { value: 'scored', label: 'Scored' },
  ]

  const approvedTeamOptions = $derived(
    approvedTeams.map((t) => ({
      value: t.id,
      label: t.name + (t.tag ? ` (${t.tag})` : ''),
    }))
  )

  function matchOptions(filteredMatches: AdminMatch[]) {
    return filteredMatches
      .filter((m) => m.team_a_id && m.team_b_id)
      .map((m) => ({ value: m.id, label: matchLabel(m) }))
  }

  function matchLabel(match: AdminMatch) {
    const a = Array.isArray(match.team_a) ? match.team_a[0] : match.team_a
    const b = Array.isArray(match.team_b) ? match.team_b[0] : match.team_b
    const names = `${a?.name ?? 'Team A'} vs ${b?.name ?? 'Team B'}`
    return match.scheduled_at
      ? `${names} - ${new Date(match.scheduled_at).toLocaleDateString()}`
      : names
  }

  const bracketMatchOptions = PLAYOFF_MATCH_IDS.map((id) => ({
    value: id,
    label: MATCH_LABELS[id],
  }))

  function toggleResolvedMatch(seasonId: string, matchId: string, checked: boolean) {
    const current = playoffConfigForm[seasonId] ?? normalizePlayoffPickemConfig(null)
    const resolved = current.resolved_matches.filter((r) => r.matchId !== matchId)
    if (checked) {
      resolved.push({ matchId: matchId as PlayoffMatchId, winnerId: '' })
    }
    updatePlayoffConfig(seasonId, { resolved_matches: resolved })
  }

  function updateResolvedWinner(seasonId: string, matchId: string, winnerId: string) {
    const current = playoffConfigForm[seasonId] ?? normalizePlayoffPickemConfig(null)
    updatePlayoffConfig(seasonId, {
      resolved_matches: current.resolved_matches.map((r) =>
        r.matchId === matchId ? { ...r, winnerId } : r
      ),
    })
  }

  function resolvedTeamOptions(seasonId: string, matchId: PlayoffMatchId) {
    const config = playoffConfigForm[seasonId] ?? normalizePlayoffPickemConfig(null)
    const seeds = config.seeds
    const mu = config.matchups.find((m) => m.matchId === matchId)
    if (mu) {
      const teamA = seeds.find((s) => s.seed === mu.seedA)
      const teamB = seeds.find((s) => s.seed === mu.seedB)
      return [teamA, teamB]
        .filter((s): s is { seed: number; teamId: string } => Boolean(s))
        .map((s) => {
          const team = approvedTeams.find((t) => t.id === s.teamId)
          return { value: s.teamId, label: team ? (team.tag ?? team.name) : `Seed ${s.seed}` }
        })
    }
    return approvedTeamOptions
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
                  <CustomSelect
                    options={pickemStatusOptions}
                    value={pickem.status}
                    compact={true}
                    placeholder="Status"
                    onSelect={(value) =>
                      updatePlayoffConfig(season.id, {
                        status: value as typeof pickem.status,
                      })}
                  />
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
                    <div>
                      <div
                        class="mb-1 text-xs font-semibold"
                        style="color: rgba(255,255,255,0.68);"
                      >
                        Seed {seed}
                      </div>
                      <CustomSelect
                        options={approvedTeamOptions}
                        value={pickem.seeds.find((entry) => entry.seed === seed)?.teamId ?? ''}
                        compact={true}
                        placeholder="Select team"
                        onSelect={(value) => updateSeed(season.id, seed, value)}
                      />
                    </div>
                  {/each}
                </div>

                <div class="mt-3">
                  <div
                    class="mb-2 text-xs font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.68);"
                  >
                    QF Matchups
                  </div>
                  <div class="grid grid-cols-1 gap-2 md:grid-cols-4">
                    {#each pickem.matchups as mu (mu.matchId)}
                      <div
                        class="rounded-md border p-2"
                        style="border-color: rgba(255,255,255,0.08); background: rgba(0,0,0,0.15);"
                      >
                        <div
                          class="mb-1 text-xs font-semibold"
                          style="color: rgba(255,255,255,0.58);"
                        >
                          {mu.matchId.replace('ub_qf_', 'QF ')}
                        </div>
                        <div class="grid grid-cols-2 gap-1">
                          <CustomSelect
                            options={seedOptions}
                            value={String(mu.seedA)}
                            compact={true}
                            placeholder="Seed A"
                            onSelect={(value) =>
                              updateMatchup(season.id, mu.matchId, 'seedA', value)}
                          />
                          <CustomSelect
                            options={seedOptions}
                            value={String(mu.seedB)}
                            compact={true}
                            placeholder="Seed B"
                            onSelect={(value) =>
                              updateMatchup(season.id, mu.matchId, 'seedB', value)}
                          />
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>

                <div class="mt-3">
                  <div
                    class="mb-2 text-xs font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.68);"
                  >
                    Resolved Matches (already concluded, no points)
                  </div>
                  <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {#each bracketMatchOptions as opt (opt.value)}
                      {@const isChecked = pickem.resolved_matches.some(
                        (r) => r.matchId === opt.value
                      )}
                      {@const resolved = pickem.resolved_matches.find(
                        (r) => r.matchId === opt.value
                      )}
                      <div
                        class="flex items-center gap-2 rounded-md border p-2"
                        style="border-color: rgba(255,255,255,0.08); background: {isChecked
                          ? 'rgba(239,68,68,0.08)'
                          : 'rgba(0,0,0,0.15)'};"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onchange={(e) =>
                            toggleResolvedMatch(
                              season.id,
                              opt.value,
                              (e.currentTarget as HTMLInputElement).checked
                            )}
                          class="accent-red-500"
                        />
                        <span
                          class="min-w-[5rem] text-xs font-semibold"
                          style="color: rgba(255,255,255,0.6);"
                        >
                          {opt.label}
                        </span>
                        {#if isChecked}
                          <div class="flex-1">
                            <CustomSelect
                              options={resolvedTeamOptions(season.id, opt.value as PlayoffMatchId)}
                              value={resolved?.winnerId ?? ''}
                              compact={true}
                              placeholder="Select winner"
                              onSelect={(value) =>
                                updateResolvedWinner(season.id, opt.value, value)}
                            />
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </div>

                <div class="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {#each pickem.match_links as link (link.matchId)}
                    <div>
                      <div
                        class="mb-1 text-xs font-semibold"
                        style="color: rgba(255,255,255,0.68);"
                      >
                        {link.matchId}
                      </div>
                      <CustomSelect
                        options={matchOptions(matches)}
                        value={link.actualMatchId ?? ''}
                        compact={true}
                        placeholder="No linked match"
                        onSelect={(value) => updateMatchLink(season.id, link.matchId, value)}
                      />
                    </div>
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
