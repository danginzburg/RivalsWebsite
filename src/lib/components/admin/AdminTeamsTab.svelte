<script lang="ts">
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { resolve } from '$app/paths'

  import { membershipRoleOptions, teamStatusOptions } from '$lib/admin/options'
  import { profileLabel } from '$lib/admin/ui'

  interface TeamRecord {
    id: string
    name: string
    tag?: string | null
    logo_url?: string | null
    roster_count?: number
    captain_profile?: unknown
    roster?: Array<{
      membership_id?: number | null
      profile_id: string
      riot_id_base?: string | null
      player_name?: string | null
      display_name?: string | null
      email?: string | null
      role: string
    }>
  }

  interface AddState {
    playerName: string
    role: string
  }

  interface EditState {
    name: string
    tag: string
    status: string
  }

  interface Props {
    teamsSearch: string
    createTeamName: string
    createTeamTag: string
    isCreatingTeam: boolean
    displayedApprovedTeams: TeamRecord[]
    addPlayerForm: Record<string, AddState>
    teamEditForm: Record<string, EditState>
    processingTeamId: string | null
    matchSeasonOptions: Array<{ value: string; label: string }>
    adminMatchSeasonId: string
    onMatchSeasonChange: (value: string) => void
    onTeamsSearchChange: (value: string) => void
    onCreateTeamNameChange: (value: string) => void
    onCreateTeamTagChange: (value: string) => void
    onCreateTeamLogoInput: (file: File | null, input: HTMLInputElement | null) => void
    onCreateTeam: () => void
    onTeamEditChange: (teamId: string, patch: Record<string, string>) => void
    onTeamLogoChange: (teamId: string, file: File | null) => void
    onSaveTeam: (teamId: string, teamName: string) => void
    onAddPlayerChange: (teamId: string, patch: Partial<AddState>) => void
    onAddPlayer: (teamId: string) => void
    onRemovePlayer: (
      teamId: string,
      membershipId: number | null,
      profileId: string,
      riotId: string,
      role: string
    ) => void
    onRemoveTeam: (teamId: string, teamName: string) => void
  }

  let {
    teamsSearch,
    createTeamName,
    createTeamTag,
    isCreatingTeam,
    displayedApprovedTeams,
    addPlayerForm,
    teamEditForm,
    processingTeamId,
    matchSeasonOptions,
    adminMatchSeasonId,
    onMatchSeasonChange,
    onTeamsSearchChange,
    onCreateTeamNameChange,
    onCreateTeamTagChange,
    onCreateTeamLogoInput,
    onCreateTeam,
    onTeamEditChange,
    onTeamLogoChange,
    onSaveTeam,
    onAddPlayerChange,
    onAddPlayer,
    onRemovePlayer,
    onRemoveTeam,
  }: Props = $props()

  let createTeamLogoInput: HTMLInputElement | null = null

  /**
   * New teams land in whichever season is being viewed, so the form says which
   * one that is rather than leaving it implicit.
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

<div class="mb-3 flex flex-col gap-2 md:flex-row md:items-center">
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
    bind:value={teamsSearch}
    placeholder="Search teams by name, tag, captain"
    class="admin-input"
    oninput={(e) => onTeamsSearchChange((e.currentTarget as HTMLInputElement).value)}
  />
</div>

<div class="admin-bordered mb-6 p-3">
  <h3
    class="mb-1 text-sm font-semibold tracking-wide uppercase"
    style="color: rgba(255,255,255,0.8);"
  >
    Create Team
  </h3>
  <p class="mb-3 text-xs" style="color: rgba(255,255,255,0.55);">
    Filed under <strong style="color: {targetSeasonIsPast ? '#fcd34d' : 'rgba(255,255,255,0.8)'};"
      >{targetSeasonLabel}</strong
    >{#if targetSeasonIsPast}
      — backfilling a past season.{/if}
  </p>

  <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
    <label class="flex flex-col gap-1 text-sm" style="color: var(--text);">
      Team Name
      <input
        bind:value={createTeamName}
        required
        minlength="2"
        maxlength="48"
        class="admin-input"
        placeholder="Team name"
        oninput={(e) => onCreateTeamNameChange((e.currentTarget as HTMLInputElement).value)}
      />
    </label>
    <label class="flex flex-col gap-1 text-sm" style="color: var(--text);">
      Tag
      <input
        bind:value={createTeamTag}
        required
        maxlength="4"
        minlength="2"
        class="admin-input"
        placeholder="TCR"
        oninput={(e) => onCreateTeamTagChange((e.currentTarget as HTMLInputElement).value)}
      />
    </label>
    <label class="flex flex-col gap-1 text-sm" style="color: var(--text);">
      Logo
      <input
        bind:this={createTeamLogoInput}
        type="file"
        accept="image/*"
        required
        class="admin-file"
        oninput={(e) =>
          onCreateTeamLogoInput(
            (e.currentTarget as HTMLInputElement).files?.[0] ?? null,
            createTeamLogoInput
          )}
      />
    </label>
  </div>

  <div class="mt-3 flex justify-end">
    <button
      type="button"
      class="admin-btn admin-btn-sm admin-btn-go"
      onclick={onCreateTeam}
      disabled={isCreatingTeam}
    >
      {isCreatingTeam ? 'Creating...' : 'Create Team'}
    </button>
  </div>
</div>

<div class="admin-bordered p-3">
  <h3
    class="mb-3 text-sm font-semibold tracking-wide uppercase"
    style="color: rgba(255,255,255,0.8);"
  >
    Approved Teams ({displayedApprovedTeams.length})
  </h3>
  {#if displayedApprovedTeams.length === 0}
    <div class="py-6 text-center text-sm" style="color: rgba(255,255,255,0.72);">
      No approved teams yet.
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
      {#each displayedApprovedTeams as team (team.id)}
        {@const addState = addPlayerForm[team.id] ?? { playerName: '', role: 'player' }}
        {@const editState = teamEditForm[team.id] ?? {
          name: team.name,
          tag: team.tag ?? '',
          status: 'active',
        }}
        <article class="admin-card p-3">
          <div class="mb-2 flex items-center gap-3">
            {#if team.logo_url}
              <img src={team.logo_url} alt="Team logo" class="h-10 w-10 rounded object-contain" />
            {:else}
              <div class="flex h-10 w-10 items-center justify-center rounded bg-white/10 text-xs">
                N/A
              </div>
            {/if}
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold" style="color: var(--text);">
                {team.name}
                {#if team.tag}
                  <span class="opacity-80"> [{team.tag}]</span>
                {/if}
              </div>
              <div class="text-xs" style="color: rgba(255,255,255,0.72);">
                Roster: {team.roster_count ?? 0}
              </div>
            </div>
          </div>

          <div class="space-y-1 text-xs" style="color: rgba(255,255,255,0.8);">
            <div>Captain: {profileLabel(team.captain_profile)}</div>
          </div>

          <div class="admin-bordered mt-3 p-3">
            <div
              class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.7);"
            >
              Team Details
            </div>
            <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
              <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                Name
                <input
                  value={editState.name}
                  class="admin-input mt-1"
                  oninput={(e) =>
                    onTeamEditChange(team.id, {
                      name: (e.currentTarget as HTMLInputElement).value,
                    })}
                />
              </label>
              <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                Tag
                <input
                  value={editState.tag}
                  class="admin-input mt-1"
                  oninput={(e) =>
                    onTeamEditChange(team.id, {
                      tag: (e.currentTarget as HTMLInputElement).value,
                    })}
                />
              </label>
              <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                Status
                <div class="mt-1">
                  <CustomSelect
                    options={teamStatusOptions}
                    value={editState.status}
                    compact={true}
                    placeholder="Status"
                    onSelect={(value) => onTeamEditChange(team.id, { status: value })}
                  />
                </div>
              </label>
              <label class="text-xs md:col-span-2" style="color: rgba(255,255,255,0.82);">
                Replace Logo
                <input
                  type="file"
                  accept="image/*"
                  class="admin-file mt-1"
                  oninput={(e) =>
                    onTeamLogoChange(
                      team.id,
                      (e.currentTarget as HTMLInputElement).files?.[0] ?? null
                    )}
                />
              </label>
            </div>
            <div class="mt-2 flex justify-end">
              <button
                type="button"
                class="admin-btn admin-btn-sm admin-btn-info"
                disabled={processingTeamId === team.id}
                onclick={() => onSaveTeam(team.id, team.name)}
              >
                {processingTeamId === team.id ? 'Saving...' : 'Save Team'}
              </button>
            </div>
          </div>

          {#if (team.roster ?? []).length > 0}
            <div class="admin-bordered mt-3 p-2">
              <div
                class="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.7);"
              >
                <span>Team Players</span>
              </div>
              <div class="flex flex-col gap-1">
                {#each team.roster ?? [] as player (player.membership_id ?? `${team.id}-${player.profile_id}`)}
                  <div
                    class="flex flex-wrap items-center justify-between gap-2 rounded px-2 py-1.5"
                    style="background: rgba(255,255,255,0.05);"
                  >
                    <div class="min-w-0 flex-1 text-xs" style="color: var(--text);">
                      <span class="font-semibold"
                        >{player.display_name ??
                          player.riot_id_base ??
                          player.player_name ??
                          player.email ??
                          'User'}</span
                      >
                      <span class="opacity-75"> - {profileLabel(player)}</span>
                      {#if player.role === 'captain'}
                        <span
                          class="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase"
                          style="background: rgba(250,204,21,0.2); color: #fde68a;"
                        >
                          Captain
                        </span>
                      {/if}
                    </div>
                    <div class="flex flex-shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        class="admin-btn admin-btn-sm admin-btn-danger"
                        disabled={processingTeamId === team.id}
                        onclick={() =>
                          onRemovePlayer(
                            team.id,
                            player.membership_id ?? null,
                            player.profile_id,
                            player.display_name ??
                              player.riot_id_base ??
                              player.player_name ??
                              player.email ??
                              'User',
                            player.role
                          )}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <div class="admin-bordered mt-3 p-2">
            <div
              class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.7);"
            >
              Add Player
            </div>

            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div class="md:col-span-2">
                <input
                  value={addState.playerName}
                  class="admin-input"
                  placeholder="Enter player name as it should appear"
                  oninput={(e) =>
                    onAddPlayerChange(team.id, {
                      playerName: (e.currentTarget as HTMLInputElement).value,
                    })}
                />
              </div>
              <div>
                <CustomSelect
                  options={membershipRoleOptions}
                  value={addState.role}
                  placeholder="Role"
                  onSelect={(value) => onAddPlayerChange(team.id, { role: value })}
                />
              </div>
            </div>

            <div class="mt-2 flex justify-end">
              <button
                type="button"
                class="admin-btn admin-btn-sm admin-btn-go"
                onclick={() => onAddPlayer(team.id)}
              >
                Add
              </button>
            </div>
          </div>

          <div class="mt-3 flex justify-end gap-2">
            <button
              type="button"
              class="admin-btn admin-btn-sm admin-btn-danger"
              disabled={processingTeamId === team.id}
              onclick={() => onRemoveTeam(team.id, team.name)}
            >
              Remove Team
            </button>
            <a href={resolve(`/teams/${team.id}`)} class="admin-btn admin-btn-sm admin-btn-info">
              Open Team Page
            </a>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>
