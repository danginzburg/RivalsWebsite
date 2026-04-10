<script lang="ts">
  import CustomSelect from '$lib/components/CustomSelect.svelte'

  import {
    bestOfOptions,
    matchStatusOptions,
    streamPlatformOptions,
    streamStatusOptions,
  } from '$lib/admin/options'
  import { teamName, toDatetimeLocal } from '$lib/admin/match-ui'

  interface Props {
    approvedTeamOptions: Array<{ label: string; value: string }>
    approvedTeams: Array<{ id: string; name: string }>
    createMatchTeamAId: string
    createMatchTeamBId: string
    createMatchBestOf: string
    createMatchScheduledAt: string
    isCreatingMatch: boolean
    matches: any[]
    matchSearchQuery: string
    showCompletedAdminMatches: boolean
    filteredAdminMatches: any[]
    expandedAdminMatchId: string | null
    finalizeForm: Record<string, { teamAScore: string; teamBScore: string; winnerTeamId: string }>
    matchEditForm: Record<string, any>
    streamForm: Record<string, any>
    existingStreamForm: Record<string, any>
    vodForm: Record<string, string>
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
    onFinalizeMatch: (match: any) => void
    onCancelMatch: (match: any) => void
    onUpdateMatchEditForm: (matchId: string, patch: Record<string, string>) => void
    onSaveMatchEdits: (matchId: string, match: any) => void
    onDeleteMatch: (matchId: string, match: any) => void
    onUpdateExistingStreamForm: (streamId: string, patch: Record<string, any>) => void
    onSaveExistingMatchStream: (matchId: string, streamId: string) => void
    onRemoveMatchStream: (matchId: string, streamId: string, label: string) => void
    onUpdateStreamForm: (matchId: string, patch: Record<string, any>) => void
    onAddMatchStream: (matchId: string) => void
    onVodChange: (matchId: string, value: string) => void
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
  }: Props = $props()
</script>

<div class="grid grid-cols-1 gap-4">
  <section class="rounded-md border p-3" style="border-color: rgba(255,255,255,0.12);">
    <div class="mb-3 flex items-center gap-2">
      <h3
        class="text-sm font-semibold tracking-wide uppercase"
        style="color: rgba(255,255,255,0.8);"
      >
        Create Match
      </h3>
    </div>

    <div class="grid grid-cols-1 gap-2 md:grid-cols-5">
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

    <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-5">
      <div class="md:col-span-4">
        <input
          type="datetime-local"
          bind:value={createMatchScheduledAt}
          class="w-full rounded-md border px-3 py-2 text-sm"
          style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
          placeholder="Scheduled (UTC)"
          disabled={isCreatingMatch}
          aria-label="Scheduled at (UTC)"
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
          class="w-full rounded-md px-3 py-2 text-sm font-semibold"
          style="background: rgba(74,222,128,0.2); color: #4ade80;"
          onclick={onCreateMatch}
          disabled={isCreatingMatch}
        >
          {isCreatingMatch ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  </section>

  <section class="rounded-md border p-3" style="border-color: rgba(255,255,255,0.12);">
    <div class="mb-3 flex items-center gap-2">
      <h3
        class="text-sm font-semibold tracking-wide uppercase"
        style="color: rgba(255,255,255,0.8);"
      >
        Matches ({matches.length})
      </h3>
    </div>

    <div class="mb-3 space-y-3">
      <input
        bind:value={matchSearchQuery}
        class="w-full rounded-lg border px-3 py-2 text-sm md:max-w-md"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2); color: var(--text);"
        placeholder="Search teams or match status"
        oninput={(e) => onMatchSearchChange((e.currentTarget as HTMLInputElement).value)}
      />
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
          }}
          {@const streamState = streamForm[match.id] ?? {
            platform: 'twitch',
            streamUrl: '',
            status: match.status === 'live' ? 'live' : 'scheduled',
            isPrimary: !(match.streams?.length > 0),
          }}
          <article
            class="rounded-md border p-3"
            style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
          >
            <button
              type="button"
              class="flex w-full flex-wrap items-center justify-between gap-2 text-left"
              onclick={() => onToggleExpandedMatch(match.id)}
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
              <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                <input
                  type="number"
                  min="0"
                  value={state.teamAScore}
                  class="rounded-md border px-2 py-1"
                  style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
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
                  class="rounded-md border px-2 py-1"
                  style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
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
                    class="rounded px-2 py-1 text-xs"
                    style="background: rgba(74,222,128,0.2); color: #4ade80;"
                    onclick={() => onFinalizeMatch(match)}
                  >
                    Finalize
                  </button>
                  <button
                    type="button"
                    class="rounded px-2 py-1 text-xs"
                    style="background: rgba(248,113,113,0.2); color: #f87171;"
                    onclick={() => onCancelMatch(match)}
                  >
                    Cancel
                  </button>
                </div>
              </div>

              <div class="mt-3 rounded-md border p-3" style="border-color: rgba(255,255,255,0.10);">
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
                      class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                      style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                      oninput={(e) =>
                        onUpdateMatchEditForm(match.id, {
                          scheduledAt: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </label>
                  <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                    Team A Score
                    <input
                      type="number"
                      min="0"
                      value={editState.teamAScore}
                      class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                      style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
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
                      class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                      style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
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
                    class="rounded px-2 py-1 text-xs font-semibold"
                    style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                    onclick={() => onSaveMatchEdits(match.id, match)}
                  >
                    Save Match
                  </button>
                  <button
                    type="button"
                    class="rounded px-2 py-1 text-xs font-semibold"
                    style="background: rgba(248,113,113,0.2); color: #fca5a5;"
                    onclick={() => onDeleteMatch(match.id, match)}
                  >
                    Delete Match
                  </button>
                </div>
              </div>

              <div class="mt-3 rounded-md border p-3" style="border-color: rgba(255,255,255,0.10);">
                <div
                  class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                  style="color: rgba(255,255,255,0.7);"
                >
                  Map Vetoes
                </div>
                <textarea
                  rows="5"
                  value={editState.mapVetoes}
                  class="w-full rounded-md border px-3 py-2 text-sm leading-5"
                  style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
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
                    class="rounded px-3 py-2 text-xs font-semibold"
                    style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                    onclick={() => onSaveMatchEdits(match.id, match)}
                  >
                    Save Vetoes
                  </button>
                </div>
              </div>

              <div class="mt-3 rounded-md border p-3" style="border-color: rgba(255,255,255,0.10);">
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
                      <div
                        class="rounded-md border px-2 py-2 text-xs"
                        style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.04);"
                      >
                        <div class="min-w-0">
                          <div style="color: var(--text);">
                            {stream.metadata?.display_name || stream.platform}
                            {stream.is_primary ? '• Primary' : ''}
                          </div>
                          <div class="truncate" style="color: rgba(255,255,255,0.68);">
                            {stream.stream_url}
                          </div>
                        </div>
                        <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                          <div class="md:col-span-2">
                            <input
                              class="w-full rounded-md border px-3 py-2 text-sm"
                              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                              value={existingState.displayName}
                              placeholder="Display name"
                              oninput={(e) =>
                                onUpdateExistingStreamForm(stream.id, {
                                  displayName: (e.currentTarget as HTMLInputElement).value,
                                })}
                            />
                          </div>
                        </div>
                        <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
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
                              class="w-full rounded-md border px-3 py-2 text-sm"
                              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
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
                              class="rounded px-2 py-1 text-[11px] font-semibold"
                              style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                              onclick={() => onSaveExistingMatchStream(match.id, stream.id)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              class="rounded px-2 py-1 text-[11px] font-semibold"
                              style="background: rgba(248,113,113,0.2); color: #fca5a5;"
                              onclick={() =>
                                onRemoveMatchStream(match.id, stream.id, stream.platform)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}

                <div class="grid grid-cols-1 gap-2 md:grid-cols-4">
                  <div class="md:col-span-2">
                    <input
                      class="w-full rounded-md border px-3 py-2 text-sm"
                      style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                      value={streamState.displayName}
                      placeholder="Display name"
                      oninput={(e) =>
                        onUpdateStreamForm(match.id, {
                          displayName: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </div>
                </div>
                <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
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
                      class="w-full rounded-md border px-3 py-2 text-sm"
                      style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
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
                    class="rounded px-2 py-1 text-xs font-semibold"
                    style="background: rgba(34,197,94,0.2); color: #86efac;"
                    onclick={() => onAddMatchStream(match.id)}
                  >
                    Add Stream
                  </button>
                </div>

                <div class="mt-4 border-t pt-4" style="border-color: rgba(255,255,255,0.10);">
                  <div
                    class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.7);"
                  >
                    YouTube VOD
                  </div>
                  <div class="flex flex-col gap-2 md:flex-row">
                    <input
                      class="w-full flex-1 rounded-md border px-3 py-2 text-sm"
                      style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                      value={vodForm[match.id] ?? ''}
                      placeholder="https://youtube.com/watch?..."
                      oninput={(e) =>
                        onVodChange(match.id, (e.currentTarget as HTMLInputElement).value)}
                    />
                    <button
                      type="button"
                      class="rounded px-3 py-2 text-xs font-semibold"
                      style="background: rgba(234,179,8,0.18); color: #fcd34d;"
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
                  href={`/matches/${match.id}`}
                  class="rounded px-2 py-1 text-xs font-semibold"
                  style="background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.85);"
                >
                  Open Match Page
                </a>
                <a
                  href={`/admin/matches/${match.id}/stats-import`}
                  class="rounded px-2 py-1 text-xs font-semibold"
                  style="background: rgba(59,130,246,0.2); color: #93c5fd;"
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
