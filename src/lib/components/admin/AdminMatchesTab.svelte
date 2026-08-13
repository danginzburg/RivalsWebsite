<script lang="ts">
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { resolve } from '$app/paths'

  import {
    bestOfOptions,
    matchStatusOptions,
    streamPlatformOptions,
    streamStatusOptions,
  } from '$lib/admin/options'
  import { teamName, toDatetimeLocal } from '$lib/admin/match-ui'
  import type { AdminMatch, MatchEditState, MatchStreamFormState } from '$lib/admin/types'

  interface Props {
    approvedTeamOptions: Array<{ label: string; value: string }>
    approvedTeams: Array<{ id: string; name: string }>
    createMatchTeamAId: string
    createMatchTeamBId: string
    createMatchBestOf: string
    createMatchScheduledAt: string
    isCreatingMatch: boolean
    matches: AdminMatch[]
    matchSearchQuery: string
    showCompletedAdminMatches: boolean
    filteredAdminMatches: AdminMatch[]
    expandedAdminMatchId: string | null
    finalizeForm: Record<string, { teamAScore: string; teamBScore: string; winnerTeamId: string }>
    matchEditForm: Record<string, MatchEditState>
    streamForm: Record<string, MatchStreamFormState>
    existingStreamForm: Record<string, MatchStreamFormState>
    vodForm: Record<string, string>
    matchMapsCache: Record<
      string,
      Array<{ id: string; map_order: number; map_name: string | null; is_voided: boolean }>
    >
    matchMapsLoading: Record<string, boolean>
    matchSeasonOptions: Array<{ value: string; label: string }>
    adminMatchSeasonId: string
    onMatchSeasonChange: (value: string) => void
    onCreateMatchTeamAIdChange: (value: string) => void
    onCreateMatchTeamBIdChange: (value: string) => void
    onCreateMatchBestOfChange: (value: string) => void
    onCreateMatchScheduledAtChange: (value: string) => void
    onCreateMatch: () => void
    onMatchSearchChange: (value: string) => void
    onShowCompletedChange: (value: boolean) => void
    onToggleExpandedMatch: (matchId: string) => void
    onUpdateFinalizeForm: (
      matchId: string,
      patch: Partial<{ teamAScore: string; teamBScore: string; winnerTeamId: string }>
    ) => void
    onFinalizeMatch: (match: AdminMatch) => void
    onCancelMatch: (match: AdminMatch) => void
    onUpdateMatchEditForm: (matchId: string, patch: Partial<MatchEditState>) => void
    onSaveMatchEdits: (matchId: string, match: AdminMatch) => void
    onDeleteMatch: (matchId: string, match: AdminMatch) => void
    onUpdateExistingStreamForm: (streamId: string, patch: Partial<MatchStreamFormState>) => void
    onSaveExistingMatchStream: (matchId: string, streamId: string) => void
    onRemoveMatchStream: (matchId: string, streamId: string, label: string) => void
    onUpdateStreamForm: (matchId: string, patch: Partial<MatchStreamFormState>) => void
    onAddMatchStream: (matchId: string) => void
    onVodChange: (matchId: string, value: string) => void
    onFetchMatchMaps: (matchId: string) => void
    onToggleMapVoided: (matchId: string, mapId: string, currentVoided: boolean) => void
  }

  let {
    approvedTeamOptions,
    approvedTeams,
    createMatchTeamAId,
    createMatchTeamBId,
    createMatchBestOf,
    createMatchScheduledAt,
    isCreatingMatch,
    matches,
    matchSearchQuery,
    showCompletedAdminMatches,
    filteredAdminMatches,
    expandedAdminMatchId,
    finalizeForm,
    matchEditForm,
    streamForm,
    existingStreamForm,
    vodForm,
    matchMapsCache,
    matchMapsLoading,
    matchSeasonOptions,
    adminMatchSeasonId,
    onMatchSeasonChange,
    onCreateMatchTeamAIdChange,
    onCreateMatchTeamBIdChange,
    onCreateMatchBestOfChange,
    onCreateMatchScheduledAtChange,
    onCreateMatch,
    onMatchSearchChange,
    onShowCompletedChange,
    onToggleExpandedMatch,
    onUpdateFinalizeForm,
    onFinalizeMatch,
    onCancelMatch,
    onUpdateMatchEditForm,
    onSaveMatchEdits,
    onDeleteMatch,
    onUpdateExistingStreamForm,
    onSaveExistingMatchStream,
    onRemoveMatchStream,
    onUpdateStreamForm,
    onAddMatchStream,
    onVodChange,
    onFetchMatchMaps,
    onToggleMapVoided,
  }: Props = $props()

  /**
   * New matches land in whichever season is being viewed, so the form says
   * which one that is rather than leaving it implicit.
   */
  const selectedSeason = $derived(
    matchSeasonOptions.find((option) => option.value === adminMatchSeasonId)
  )
  const targetSeasonLabel = $derived(
    !adminMatchSeasonId
      ? 'the active season'
      : adminMatchSeasonId === '__none__'
        ? 'no season'
        : (selectedSeason?.label ?? 'the selected season')
  )
  const targetSeasonIsPast = $derived(
    Boolean(adminMatchSeasonId) &&
      adminMatchSeasonId !== '__none__' &&
      !(selectedSeason?.label ?? '').includes('Active')
  )
</script>

<div class="grid grid-cols-1 gap-4">
  <section class="admin-bordered p-3">
    <div class="mb-1 flex items-center gap-2">
      <h3
        class="text-sm font-semibold tracking-wide uppercase"
        style="color: rgba(255,255,255,0.8);"
      >
        Create Match
      </h3>
    </div>
    <p class="mb-3 text-xs" style="color: rgba(255,255,255,0.55);">
      Filed under <strong style="color: {targetSeasonIsPast ? '#fcd34d' : 'rgba(255,255,255,0.8)'};"
        >{targetSeasonLabel}</strong
      >{#if targetSeasonIsPast}
        — backfilling a past season.{/if}
    </p>

    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <div class="md:col-span-2">
        <CustomSelect
          options={approvedTeamOptions}
          value={createMatchTeamAId}
          placeholder="Team A"
          compact={true}
          disabled={isCreatingMatch}
          onSelect={onCreateMatchTeamAIdChange}
        />
      </div>
      <div class="md:col-span-2">
        <CustomSelect
          options={approvedTeamOptions}
          value={createMatchTeamBId}
          placeholder="Team B"
          compact={true}
          disabled={isCreatingMatch}
          onSelect={onCreateMatchTeamBIdChange}
        />
      </div>
      <div>
        <CustomSelect
          options={bestOfOptions}
          value={createMatchBestOf}
          placeholder="BO3"
          compact={true}
          disabled={isCreatingMatch}
          onSelect={onCreateMatchBestOfChange}
        />
      </div>
    </div>

    <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <div class="md:col-span-4">
        <input
          type="datetime-local"
          bind:value={createMatchScheduledAt}
          class="admin-input"
          placeholder="Scheduled (local time)"
          disabled={isCreatingMatch}
          aria-label="Scheduled at (local time)"
          oninput={(e) =>
            onCreateMatchScheduledAtChange((e.currentTarget as HTMLInputElement).value)}
        />
        <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.65);">
          Optional. Uses your local browser time.
        </div>
      </div>
      <div class="md:col-span-1">
        <button
          type="button"
          class="admin-btn admin-btn-go w-full text-sm"
          onclick={onCreateMatch}
          disabled={isCreatingMatch}
        >
          {isCreatingMatch ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  </section>

  <section class="admin-bordered p-3">
    <div class="mb-3 flex items-center gap-2">
      <h3
        class="text-sm font-semibold tracking-wide uppercase"
        style="color: rgba(255,255,255,0.8);"
      >
        Matches ({matches.length})
      </h3>
    </div>

    <div class="mb-3 space-y-3">
      <div class="flex flex-col gap-2 md:flex-row md:items-center">
        <div class="md:max-w-xs">
          <CustomSelect
            options={matchSeasonOptions}
            value={adminMatchSeasonId}
            compact={true}
            placeholder="Filter by season"
            onSelect={onMatchSeasonChange}
          />
        </div>
        <input
          bind:value={matchSearchQuery}
          class="w-full rounded-lg border px-3 py-2 text-sm md:max-w-md"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2); color: var(--text);"
          placeholder="Search teams or match status"
          oninput={(e) => onMatchSearchChange((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <label
        class="inline-flex w-full items-center gap-2 text-sm"
        style="color: rgba(255,255,255,0.8);"
      >
        <input
          bind:checked={showCompletedAdminMatches}
          type="checkbox"
          onchange={(e) => onShowCompletedChange((e.currentTarget as HTMLInputElement).checked)}
        />
        Show completed matches
      </label>
    </div>

    {#if filteredAdminMatches.length === 0}
      <p class="text-sm" style="color: rgba(255,255,255,0.72);">
        {matches.length === 0 ? 'No matches found.' : 'No matches match the current filters.'}
      </p>
    {:else}
      <div class="flex flex-col gap-2">
        {#each filteredAdminMatches as match (match.id)}
          {@const state = finalizeForm[match.id] ?? {
            teamAScore: String(match.team_a_score ?? 0),
            teamBScore: String(match.team_b_score ?? 0),
            winnerTeamId: match.winner_team_id ?? match.team_a_id,
          }}
          {@const editState = matchEditForm[match.id] ?? {
            teamAId: match.team_a_id,
            teamBId: match.team_b_id,
            bestOf: String(match.best_of ?? 3),
            status: match.status ?? 'scheduled',
            scheduledAt: toDatetimeLocal(match.scheduled_at),
            teamAScore: String(match.team_a_score ?? 0),
            teamBScore: String(match.team_b_score ?? 0),
            winnerTeamId: match.winner_team_id ?? '',
            mapVetoes: Array.isArray(match.metadata?.map_vetoes)
              ? match.metadata.map_vetoes.join('\n')
              : '',
            designation: match.metadata?.designation ?? '',
          }}
          {@const streamState = streamForm[match.id] ?? {
            platform: 'twitch',
            streamUrl: '',
            status: match.status === 'live' ? 'live' : 'scheduled',
            isPrimary: !(match.streams?.length > 0),
          }}
          {@const maps = matchMapsCache[match.id] ?? []}
          <article class="admin-card p-3">
            <button
              type="button"
              class="flex w-full flex-wrap items-center justify-between gap-2 text-left"
              onclick={() => {
                onToggleExpandedMatch(match.id)
                onFetchMatchMaps(match.id)
              }}
            >
              <div>
                <div class="text-sm" style="color: var(--text);">
                  <strong>{teamName(match.team_a)}</strong> vs
                  <strong>{teamName(match.team_b)}</strong>
                </div>
                <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.68);">
                  BO{match.best_of}
                  {#if match.scheduled_at}
                    <span> • {toDatetimeLocal(match.scheduled_at).replace('T', ' ')}</span>
                  {/if}
                  {#if match.status === 'completed'}
                    <span> • {match.team_a_score}-{match.team_b_score}</span>
                  {/if}
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span
                  class="rounded-full px-2 py-1 text-xs font-bold"
                  style="background: rgba(255,255,255,0.12); color: var(--text);"
                >
                  {match.status}
                </span>
                <span class="text-xs" style="color: rgba(255,255,255,0.7);">
                  {expandedAdminMatchId === match.id ? 'Hide' : 'Show'}
                </span>
              </div>
            </button>

            {#if expandedAdminMatchId === match.id}
              <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <input
                  type="number"
                  min="0"
                  value={state.teamAScore}
                  class="admin-input"
                  placeholder="Team A score"
                  oninput={(e) =>
                    onUpdateFinalizeForm(match.id, {
                      teamAScore: (e.currentTarget as HTMLInputElement).value,
                    })}
                />
                <input
                  type="number"
                  min="0"
                  value={state.teamBScore}
                  class="admin-input"
                  placeholder="Team B score"
                  oninput={(e) =>
                    onUpdateFinalizeForm(match.id, {
                      teamBScore: (e.currentTarget as HTMLInputElement).value,
                    })}
                />
                <CustomSelect
                  options={[
                    { value: match.team_a_id, label: teamName(match.team_a) },
                    { value: match.team_b_id, label: teamName(match.team_b) },
                  ]}
                  value={state.winnerTeamId}
                  compact={true}
                  placeholder="Winner"
                  onSelect={(value) =>
                    onUpdateFinalizeForm(match.id, {
                      winnerTeamId: value,
                    })}
                />
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="admin-btn admin-btn-sm admin-btn-go"
                    onclick={() => onFinalizeMatch(match)}
                  >
                    Finalize
                  </button>
                  <button
                    type="button"
                    class="admin-btn admin-btn-sm admin-btn-danger"
                    onclick={() => onCancelMatch(match)}
                  >
                    Cancel
                  </button>
                </div>
              </div>

              <div class="admin-bordered mt-3 p-3">
                <div
                  class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                  style="color: rgba(255,255,255,0.7);"
                >
                  Edit Match
                </div>
                <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div>
                    <CustomSelect
                      options={approvedTeamOptions}
                      value={editState.teamAId}
                      compact={true}
                      placeholder="Team A"
                      onSelect={(value) => onUpdateMatchEditForm(match.id, { teamAId: value })}
                    />
                  </div>
                  <div>
                    <CustomSelect
                      options={approvedTeamOptions}
                      value={editState.teamBId}
                      compact={true}
                      placeholder="Team B"
                      onSelect={(value) => onUpdateMatchEditForm(match.id, { teamBId: value })}
                    />
                  </div>
                  <div>
                    <CustomSelect
                      options={bestOfOptions}
                      value={editState.bestOf}
                      compact={true}
                      placeholder="Best Of"
                      onSelect={(value) => onUpdateMatchEditForm(match.id, { bestOf: value })}
                    />
                  </div>
                  <div>
                    <CustomSelect
                      options={matchStatusOptions}
                      value={editState.status}
                      compact={true}
                      placeholder="Status"
                      onSelect={(value) => onUpdateMatchEditForm(match.id, { status: value })}
                    />
                  </div>
                  <label class="text-xs md:col-span-2" style="color: rgba(255,255,255,0.82);">
                    Scheduled
                    <input
                      type="datetime-local"
                      value={editState.scheduledAt}
                      class="admin-input mt-1"
                      oninput={(e) =>
                        onUpdateMatchEditForm(match.id, {
                          scheduledAt: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </label>
                  <label class="text-xs md:col-span-2" style="color: rgba(255,255,255,0.82);">
                    Designation
                    <input
                      value={editState.designation}
                      class="admin-input mt-1"
                      placeholder="e.g. Grand Finals, Upper Bracket QF, Week 3"
                      oninput={(e) =>
                        onUpdateMatchEditForm(match.id, {
                          designation: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </label>
                  <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                    Team A Score
                    <input
                      type="number"
                      min="0"
                      value={editState.teamAScore}
                      class="admin-input mt-1"
                      oninput={(e) =>
                        onUpdateMatchEditForm(match.id, {
                          teamAScore: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </label>
                  <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                    Team B Score
                    <input
                      type="number"
                      min="0"
                      value={editState.teamBScore}
                      class="admin-input mt-1"
                      oninput={(e) =>
                        onUpdateMatchEditForm(match.id, {
                          teamBScore: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </label>
                  <div class="md:col-span-2">
                    <CustomSelect
                      options={[
                        { value: '', label: 'Unset winner' },
                        {
                          value: editState.teamAId,
                          label:
                            approvedTeams.find((team) => team.id === editState.teamAId)?.name ??
                            'Team A',
                        },
                        {
                          value: editState.teamBId,
                          label:
                            approvedTeams.find((team) => team.id === editState.teamBId)?.name ??
                            'Team B',
                        },
                      ]}
                      value={editState.winnerTeamId}
                      compact={true}
                      placeholder="Winner"
                      onSelect={(value) => onUpdateMatchEditForm(match.id, { winnerTeamId: value })}
                    />
                  </div>
                </div>
                <div class="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    class="admin-btn admin-btn-sm admin-btn-info"
                    onclick={() => onSaveMatchEdits(match.id, match)}
                  >
                    Save Match
                  </button>
                  <button
                    type="button"
                    class="admin-btn admin-btn-sm admin-btn-danger"
                    onclick={() => onDeleteMatch(match.id, match)}
                  >
                    Delete Match
                  </button>
                </div>
              </div>

              <div class="admin-bordered mt-3 p-3">
                <div
                  class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                  style="color: rgba(255,255,255,0.7);"
                >
                  Maps - Void / FF
                </div>
                {#if maps.length > 0}
                  <div class="space-y-2">
                    {#each maps as map (map.id)}
                      <div
                        class="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
                        style="border-color: {map.is_voided
                          ? 'rgba(248,113,113,0.28)'
                          : 'rgba(255,255,255,0.10)'}; background: {map.is_voided
                          ? 'rgba(248,113,113,0.08)'
                          : 'rgba(255,255,255,0.04)'};"
                      >
                        <div style="color: var(--text);">
                          Map {map.map_order}{map.map_name ? ` - ${map.map_name}` : ''}
                          {#if map.is_voided}
                            <span class="ml-2 font-bold" style="color: #fca5a5;">VOIDED / FF</span>
                          {/if}
                        </div>
                        <button
                          type="button"
                          class="rounded px-2 py-1 text-[11px] font-semibold"
                          style={map.is_voided
                            ? 'background: rgba(74,222,128,0.16); color: #86efac;'
                            : 'background: rgba(248,113,113,0.16); color: #fca5a5;'}
                          onclick={() => onToggleMapVoided(match.id, map.id, map.is_voided)}
                        >
                          {map.is_voided ? 'Restore' : 'Mark Voided/FF'}
                        </button>
                      </div>
                    {/each}
                  </div>
                {:else if matchMapsLoading[match.id]}
                  <p class="text-xs" style="color: rgba(255,255,255,0.62);">Loading maps...</p>
                {:else}
                  <p class="text-xs" style="color: rgba(255,255,255,0.62);">No maps recorded.</p>
                {/if}
              </div>

              <div class="admin-bordered mt-3 p-3">
                <div
                  class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                  style="color: rgba(255,255,255,0.7);"
                >
                  Map Vetoes
                </div>
                <textarea
                  rows="5"
                  value={editState.mapVetoes}
                  class="admin-input leading-5"
                  placeholder="One line per veto item
Ban: Team A - Haven
Pick: Team B - Lotus
Decider: Pearl"
                  oninput={(e) =>
                    onUpdateMatchEditForm(match.id, {
                      mapVetoes: (e.currentTarget as HTMLTextAreaElement).value,
                    })}
                ></textarea>
                <div class="mt-2 flex items-center justify-between gap-2">
                  <div class="text-[11px]" style="color: rgba(255,255,255,0.6);">
                    Saves via the same match update flow.
                  </div>
                  <button
                    type="button"
                    class="admin-btn admin-btn-sm admin-btn-info"
                    onclick={() => onSaveMatchEdits(match.id, match)}
                  >
                    Save Vetoes
                  </button>
                </div>
              </div>

              <div class="admin-bordered mt-3 p-3">
                <div
                  class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                  style="color: rgba(255,255,255,0.7);"
                >
                  Streams
                </div>
                {#if (match.streams ?? []).length > 0}
                  <div class="mb-3 flex flex-col gap-2">
                    {#each match.streams as stream (stream.id)}
                      {@const existingState = existingStreamForm[stream.id] ?? {
                        platform: stream.platform,
                        streamUrl: stream.stream_url,
                        status: stream.status,
                        isPrimary: stream.is_primary,
                      }}
                      <div class="admin-subcard rounded-md border px-2 py-2 text-xs">
                        <div class="min-w-0">
                          <div style="color: var(--text);">
                            {stream.metadata?.display_name || stream.platform}
                            {stream.is_primary ? '• Primary' : ''}
                          </div>
                          <div class="truncate" style="color: rgba(255,255,255,0.68);">
                            {stream.stream_url}
                          </div>
                        </div>
                        <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <div class="md:col-span-2">
                            <input
                              class="admin-input"
                              value={existingState.displayName}
                              placeholder="Display name"
                              oninput={(e) =>
                                onUpdateExistingStreamForm(stream.id, {
                                  displayName: (e.currentTarget as HTMLInputElement).value,
                                })}
                            />
                          </div>
                        </div>
                        <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <CustomSelect
                              options={streamPlatformOptions}
                              value={existingState.platform}
                              compact={true}
                              placeholder="Platform"
                              onSelect={(value) =>
                                onUpdateExistingStreamForm(stream.id, { platform: value })}
                            />
                          </div>
                          <div class="md:col-span-2">
                            <input
                              class="admin-input"
                              value={existingState.streamUrl}
                              oninput={(e) =>
                                onUpdateExistingStreamForm(stream.id, {
                                  streamUrl: (e.currentTarget as HTMLInputElement).value,
                                })}
                            />
                          </div>
                          <div>
                            <CustomSelect
                              options={streamStatusOptions}
                              value={existingState.status}
                              compact={true}
                              placeholder="Stream status"
                              onSelect={(value) =>
                                onUpdateExistingStreamForm(stream.id, { status: value })}
                            />
                          </div>
                        </div>
                        <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <label
                            class="inline-flex items-center gap-2 text-xs"
                            style="color: rgba(255,255,255,0.82);"
                          >
                            <input
                              type="checkbox"
                              checked={existingState.isPrimary}
                              onchange={(e) =>
                                onUpdateExistingStreamForm(stream.id, {
                                  isPrimary: (e.currentTarget as HTMLInputElement).checked,
                                })}
                            />
                            Mark as primary stream
                          </label>
                          <div class="flex gap-2">
                            <button
                              type="button"
                              class="admin-btn admin-btn-sm admin-btn-info"
                              onclick={() => onSaveExistingMatchStream(match.id, stream.id)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              class="admin-btn admin-btn-sm admin-btn-danger"
                              onclick={() =>
                                onRemoveMatchStream(
                                  match.id,
                                  stream.id,
                                  stream.platform ?? 'stream'
                                )}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}

                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div class="md:col-span-2">
                    <input
                      class="admin-input"
                      value={streamState.displayName}
                      placeholder="Display name"
                      oninput={(e) =>
                        onUpdateStreamForm(match.id, {
                          displayName: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </div>
                </div>
                <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <CustomSelect
                      options={streamPlatformOptions}
                      value={streamState.platform}
                      compact={true}
                      placeholder="Platform"
                      onSelect={(value) => onUpdateStreamForm(match.id, { platform: value })}
                    />
                  </div>
                  <div class="md:col-span-2">
                    <input
                      class="admin-input"
                      value={streamState.streamUrl}
                      placeholder="Input stream link here"
                      oninput={(e) =>
                        onUpdateStreamForm(match.id, {
                          streamUrl: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </div>
                  <div>
                    <CustomSelect
                      options={streamStatusOptions}
                      value={streamState.status}
                      compact={true}
                      placeholder="Stream status"
                      onSelect={(value) => onUpdateStreamForm(match.id, { status: value })}
                    />
                  </div>
                </div>
                <label
                  class="mt-2 inline-flex items-center gap-2 text-xs"
                  style="color: rgba(255,255,255,0.82);"
                >
                  <input
                    type="checkbox"
                    checked={streamState.isPrimary}
                    onchange={(e) =>
                      onUpdateStreamForm(match.id, {
                        isPrimary: (e.currentTarget as HTMLInputElement).checked,
                      })}
                  />
                  Mark as primary stream
                </label>
                <div class="mt-2 flex justify-end">
                  <button
                    type="button"
                    class="admin-btn admin-btn-sm admin-btn-go"
                    onclick={() => onAddMatchStream(match.id)}
                  >
                    Add Stream
                  </button>
                </div>

                <div class="admin-divide mt-4 border-t pt-4">
                  <div
                    class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.7);"
                  >
                    YouTube VOD
                  </div>
                  <div class="flex flex-col gap-2 md:flex-row">
                    <input
                      class="admin-input flex-1"
                      value={vodForm[match.id] ?? ''}
                      placeholder="https://youtube.com/watch?..."
                      oninput={(e) =>
                        onVodChange(match.id, (e.currentTarget as HTMLInputElement).value)}
                    />
                    <button
                      type="button"
                      class="admin-btn admin-btn-sm admin-btn-warn"
                      onclick={() => onSaveMatchEdits(match.id, match)}
                    >
                      Save VOD
                    </button>
                  </div>
                  <div class="mt-2 text-[11px]" style="color: rgba(255,255,255,0.6);">
                    Saves via the same match update flow.
                  </div>
                </div>
              </div>

              <div class="mt-2 flex flex-wrap gap-2">
                <a
                  href={resolve(`/matches/${match.id}`)}
                  class="admin-btn admin-btn-sm admin-btn-neutral"
                >
                  Open Match Page
                </a>
                <a
                  href={resolve(`/admin/matches/${match.id}/stats-import`)}
                  class="admin-btn admin-btn-sm admin-btn-info"
                >
                  Import Map Stats
                </a>
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>
