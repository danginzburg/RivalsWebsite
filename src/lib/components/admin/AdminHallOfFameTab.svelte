<script lang="ts">
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import type { HallOfFameEntry, HallOfFameFormState } from '$lib/admin/types'

  interface Props {
    entries: HallOfFameEntry[]
    entriesLoaded: boolean
    createForm: HallOfFameFormState
    editForm: Record<string, HallOfFameFormState>
    teamOptions: Array<{ value: string; label: string }>
    playerOptions: Array<{ value: string; label: string }>
    seasonOptions: Array<{ value: string; label: string }>
    processingEntryId: string | null
    isCreating: boolean
    onCreateFormChange: (patch: Partial<HallOfFameFormState>) => void
    onEditFormChange: (entryId: string, patch: Partial<HallOfFameFormState>) => void
    onCreate: () => void
    onSave: (entryId: string) => void
    onDelete: (entryId: string, title: string) => void
  }

  let {
    entries,
    entriesLoaded,
    createForm,
    editForm,
    teamOptions,
    playerOptions,
    seasonOptions,
    processingEntryId,
    isCreating,
    onCreateFormChange,
    onEditFormChange,
    onCreate,
    onSave,
    onDelete,
  }: Props = $props()

  let expandedEntryId = $state<string | null>(null)
  let typeFilter = $state<string>('')

  const typeOptions = [
    { value: 'record', label: 'Record' },
    { value: 'moment', label: 'Moment' },
    { value: 'award', label: 'Award' },
  ]

  const filterOptions = [{ value: '', label: 'All types' }, ...typeOptions]

  const visibleEntries = $derived(
    typeFilter ? entries.filter((e) => e.entry_type === typeFilter) : entries
  )

  const inputStyle =
    'border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);'

  function stateFor(entry: HallOfFameEntry): HallOfFameFormState {
    return (
      editForm[entry.id] ?? {
        entryType: entry.entry_type,
        title: entry.title,
        description: entry.description ?? '',
        statValue: entry.stat_value ?? '',
        statLabel: entry.stat_label ?? '',
        mediaUrl: entry.media_url ?? '',
        playerName: entry.player_name ?? '',
        profileId: entry.profile_id ?? '',
        teamId: entry.team_id ?? '',
        seasonId: entry.season_id ?? '',
        isPublished: entry.is_published,
        sortOrder: String(entry.sort_order ?? 0),
      }
    )
  }

  function typeColor(type: string) {
    if (type === 'record') return 'background: rgba(96,165,250,0.16); color: #93c5fd;'
    if (type === 'moment') return 'background: rgba(251,146,60,0.16); color: #fdba74;'
    return 'background: rgba(192,132,252,0.16); color: #d8b4fe;'
  }
</script>

<div class="grid grid-cols-1 gap-4">
  <!-- Create -->
  <section class="rounded-md border p-3" style="border-color: rgba(255,255,255,0.12);">
    <div
      class="mb-3 text-sm font-semibold tracking-wide uppercase"
      style="color: rgba(255,255,255,0.8);"
    >
      Add Entry
    </div>

    <div class="grid grid-cols-1 gap-2 md:grid-cols-4">
      <div>
        <div class="mb-1 text-xs font-semibold" style="color: rgba(255,255,255,0.68);">Type</div>
        <CustomSelect
          options={typeOptions}
          value={createForm.entryType}
          compact={true}
          placeholder="Type"
          onSelect={(value) =>
            onCreateFormChange({ entryType: value as HallOfFameFormState['entryType'] })}
        />
      </div>
      <input
        value={createForm.title}
        class="rounded-md border px-3 py-2 text-sm md:col-span-3"
        style={inputStyle}
        placeholder="Title (e.g. Most Kills in a Map)"
        oninput={(e) => onCreateFormChange({ title: (e.currentTarget as HTMLInputElement).value })}
      />
    </div>

    <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
      <input
        value={createForm.statValue}
        class="rounded-md border px-3 py-2 text-sm"
        style={inputStyle}
        placeholder="Stat value (42)"
        oninput={(e) =>
          onCreateFormChange({ statValue: (e.currentTarget as HTMLInputElement).value })}
      />
      <input
        value={createForm.statLabel}
        class="rounded-md border px-3 py-2 text-sm"
        style={inputStyle}
        placeholder="Stat label (kills)"
        oninput={(e) =>
          onCreateFormChange({ statLabel: (e.currentTarget as HTMLInputElement).value })}
      />
      <div>
        <CustomSelect
          options={playerOptions}
          value={createForm.profileId}
          compact={true}
          placeholder="Player (optional)"
          onSelect={(value) => onCreateFormChange({ profileId: value })}
        />
      </div>
      <div>
        <CustomSelect
          options={seasonOptions}
          value={createForm.seasonId}
          compact={true}
          placeholder="Season (optional)"
          onSelect={(value) => onCreateFormChange({ seasonId: value })}
        />
      </div>
    </div>

    <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
      <input
        value={createForm.playerName}
        class="rounded-md border px-3 py-2 text-sm"
        style={inputStyle}
        placeholder="Or type a name (unclaimed player)"
        oninput={(e) =>
          onCreateFormChange({ playerName: (e.currentTarget as HTMLInputElement).value })}
      />
      <div>
        <CustomSelect
          options={teamOptions}
          value={createForm.teamId}
          compact={true}
          placeholder="Team (optional)"
          onSelect={(value) => onCreateFormChange({ teamId: value })}
        />
      </div>
      <input
        value={createForm.mediaUrl}
        class="rounded-md border px-3 py-2 text-sm"
        style={inputStyle}
        placeholder="Clip URL (optional)"
        oninput={(e) =>
          onCreateFormChange({ mediaUrl: (e.currentTarget as HTMLInputElement).value })}
      />
    </div>

    <textarea
      rows="2"
      value={createForm.description}
      class="mt-2 w-full rounded-md border px-3 py-2 text-sm leading-5"
      style={inputStyle}
      placeholder="Description (optional)"
      oninput={(e) =>
        onCreateFormChange({ description: (e.currentTarget as HTMLTextAreaElement).value })}
    ></textarea>

    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
      <label class="inline-flex items-center gap-2 text-sm" style="color: rgba(255,255,255,0.82);">
        <input
          type="checkbox"
          checked={createForm.isPublished}
          onchange={(e) =>
            onCreateFormChange({ isPublished: (e.currentTarget as HTMLInputElement).checked })}
        />
        Published
      </label>
      <button
        type="button"
        class="rounded-md px-3 py-2 text-sm font-semibold"
        style="background: rgba(74,222,128,0.18); color: #86efac;"
        onclick={onCreate}
        disabled={isCreating}
      >
        {isCreating ? 'Adding...' : 'Add Entry'}
      </button>
    </div>
  </section>

  <!-- List -->
  <section class="rounded-md border p-3" style="border-color: rgba(255,255,255,0.12);">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div
        class="text-sm font-semibold tracking-wide uppercase"
        style="color: rgba(255,255,255,0.8);"
      >
        Entries ({visibleEntries.length})
      </div>
      <div class="w-full md:w-48">
        <CustomSelect
          options={filterOptions}
          value={typeFilter}
          compact={true}
          placeholder="Filter by type"
          onSelect={(value) => (typeFilter = value)}
        />
      </div>
    </div>

    {#if !entriesLoaded}
      <div class="py-10 text-center text-sm" style="color: rgba(255,255,255,0.72);">
        Loading entries...
      </div>
    {:else if visibleEntries.length === 0}
      <div class="py-10 text-center text-sm" style="color: rgba(255,255,255,0.72);">
        No entries yet.
      </div>
    {:else}
      <div class="grid grid-cols-1 gap-2">
        {#each visibleEntries as entry (entry.id)}
          {@const state = stateFor(entry)}
          {@const isExpanded = expandedEntryId === entry.id}
          <article
            class="rounded-md border"
            style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
          >
            <button
              type="button"
              class="flex w-full items-center gap-3 p-3 text-left"
              style="cursor: pointer;"
              onclick={() => (expandedEntryId = isExpanded ? null : entry.id)}
            >
              <span
                class="inline-block text-xs"
                style="color: rgba(255,255,255,0.5); transform: rotate({isExpanded
                  ? '90deg'
                  : '0deg'});">▶</span
              >
              <span
                class="rounded px-2 py-0.5 text-[10px] font-bold uppercase"
                style={typeColor(entry.entry_type)}
              >
                {entry.entry_type}
              </span>
              <span class="flex-1 truncate text-sm font-semibold" style="color: var(--text);">
                {entry.title}
                {#if entry.stat_value}
                  <span style="color: rgba(255,255,255,0.5);"> · {entry.stat_value}</span>
                {/if}
              </span>
              {#if !entry.is_published}
                <span
                  class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                  style="background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6);"
                >
                  Draft
                </span>
              {/if}
            </button>

            {#if isExpanded}
              <div class="px-3 pb-3">
                <div class="grid grid-cols-1 gap-2 md:grid-cols-4">
                  <div>
                    <div class="mb-1 text-xs font-semibold" style="color: rgba(255,255,255,0.68);">
                      Type
                    </div>
                    <CustomSelect
                      options={typeOptions}
                      value={state.entryType}
                      compact={true}
                      placeholder="Type"
                      onSelect={(value) =>
                        onEditFormChange(entry.id, {
                          entryType: value as HallOfFameFormState['entryType'],
                        })}
                    />
                  </div>
                  <label class="text-xs md:col-span-3" style="color: rgba(255,255,255,0.82);">
                    Title
                    <input
                      value={state.title}
                      class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                      style={inputStyle}
                      oninput={(e) =>
                        onEditFormChange(entry.id, {
                          title: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </label>
                </div>

                <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                  <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                    Stat Value
                    <input
                      value={state.statValue}
                      class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                      style={inputStyle}
                      oninput={(e) =>
                        onEditFormChange(entry.id, {
                          statValue: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </label>
                  <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                    Stat Label
                    <input
                      value={state.statLabel}
                      class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                      style={inputStyle}
                      oninput={(e) =>
                        onEditFormChange(entry.id, {
                          statLabel: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </label>
                  <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                    Player
                    <div class="mt-1">
                      <CustomSelect
                        options={playerOptions}
                        value={state.profileId}
                        compact={true}
                        placeholder="No player"
                        onSelect={(value) => onEditFormChange(entry.id, { profileId: value })}
                      />
                    </div>
                  </label>
                  <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                    Season
                    <div class="mt-1">
                      <CustomSelect
                        options={seasonOptions}
                        value={state.seasonId}
                        compact={true}
                        placeholder="No season"
                        onSelect={(value) => onEditFormChange(entry.id, { seasonId: value })}
                      />
                    </div>
                  </label>
                </div>

                <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                  <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                    Name (unclaimed)
                    <input
                      value={state.playerName}
                      class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                      style={inputStyle}
                      oninput={(e) =>
                        onEditFormChange(entry.id, {
                          playerName: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </label>
                  <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                    Team
                    <div class="mt-1">
                      <CustomSelect
                        options={teamOptions}
                        value={state.teamId}
                        compact={true}
                        placeholder="No team"
                        onSelect={(value) => onEditFormChange(entry.id, { teamId: value })}
                      />
                    </div>
                  </label>
                  <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                    Clip URL
                    <input
                      value={state.mediaUrl}
                      class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                      style={inputStyle}
                      oninput={(e) =>
                        onEditFormChange(entry.id, {
                          mediaUrl: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </label>
                  <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                    Sort Order
                    <input
                      type="number"
                      value={state.sortOrder}
                      class="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                      style={inputStyle}
                      oninput={(e) =>
                        onEditFormChange(entry.id, {
                          sortOrder: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </label>
                </div>

                <label class="mt-2 block text-xs" style="color: rgba(255,255,255,0.82);">
                  Description
                  <textarea
                    rows="2"
                    value={state.description}
                    class="mt-1 w-full rounded-md border px-3 py-2 text-sm leading-5"
                    style={inputStyle}
                    oninput={(e) =>
                      onEditFormChange(entry.id, {
                        description: (e.currentTarget as HTMLTextAreaElement).value,
                      })}
                  ></textarea>
                </label>

                <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <label
                    class="inline-flex items-center gap-2 text-sm"
                    style="color: rgba(255,255,255,0.82);"
                  >
                    <input
                      type="checkbox"
                      checked={state.isPublished}
                      onchange={(e) =>
                        onEditFormChange(entry.id, {
                          isPublished: (e.currentTarget as HTMLInputElement).checked,
                        })}
                    />
                    Published
                  </label>
                  <div class="flex gap-2">
                    <button
                      type="button"
                      class="rounded-md px-3 py-2 text-xs font-semibold"
                      style="background: rgba(248,113,113,0.2); color: #f87171;"
                      disabled={processingEntryId === entry.id}
                      onclick={() => onDelete(entry.id, entry.title)}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      class="rounded-md px-3 py-2 text-xs font-semibold"
                      style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                      disabled={processingEntryId === entry.id}
                      onclick={() => onSave(entry.id)}
                    >
                      {processingEntryId === entry.id ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>
