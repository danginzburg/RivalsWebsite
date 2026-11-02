<script lang="ts">
  import { onMount } from 'svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { adminJsonRequest } from '$lib/admin/api'

  interface Props {
    teamOptions: Array<{ value: string; label: string }>
    playerOptions: Array<{ value: string; label: string }>
  }

  let { teamOptions, playerOptions }: Props = $props()

  type Override = {
    entry_key: string
    is_hidden: boolean
    title: string | null
    description: string | null
    value_text: string | null
    unit: string | null
    profile_id: string | null
    player_name: string | null
    team_id: string | null
    label: string | null
  }

  type Entry = {
    id: string
    rank: number | null
    entryKey: string
    value: string
    unit: string
    holder: { name: string } | null
    team: { name: string } | null
    opponent: { name: string } | null
    mapName: string | null
    stats: { value: string; unit: string; holder: string | null; team: string | null }
    override: Override | null
  }

  type Category = {
    category: string
    title: string
    defaultTitle: string
    description: string | null
    isHidden: boolean
    holderKind: 'player' | 'team'
    categoryOverride: Override | null
    top: Entry[]
    detachedEdits: Override[]
  }

  type Track = { key: string; label: string; isDisplayed: boolean; categories: Category[] }

  type CategoryDraft = { title: string; description: string; isHidden: boolean }
  type EntryDraft = {
    valueText: string
    unit: string
    profileId: string
    playerName: string
    teamId: string
  }

  let tracks = $state<Track[]>([])
  let loaded = $state(false)
  let loadError = $state<string | null>(null)
  let openCategory = $state<string | null>(null)
  let openEntry = $state<string | null>(null)
  let categoryDrafts = $state<Record<string, CategoryDraft>>({})
  let entryDrafts = $state<Record<string, EntryDraft>>({})
  let busy = $state<string | null>(null)
  let message = $state<string | null>(null)
  let rebuilding = $state(false)

  const fromStats = { value: '', label: 'From stats' }
  const playerChoices = $derived([fromStats, ...playerOptions])
  const teamChoices = $derived([fromStats, ...teamOptions])

  const categoryKey = (track: string, category: string) => `${track}|${category}`
  const entryKeyOf = (track: string, category: string, entry: string) =>
    `${track}|${category}|${entry}`

  function holderName(entry: Entry) {
    if (entry.holder) return entry.holder.name
    if (!entry.team) return ''
    return entry.opponent ? `${entry.team.name} vs ${entry.opponent.name}` : entry.team.name
  }

  function label(entry: Entry) {
    const who =
      entry.stats.holder ??
      (entry.stats.team && entry.opponent
        ? `${entry.stats.team} vs ${entry.opponent.name}`
        : entry.stats.team)
    return [`${entry.stats.value} ${entry.stats.unit}`, who, entry.mapName]
      .filter(Boolean)
      .join(' · ')
  }

  function toggleCategory(track: string, cat: Category) {
    const key = categoryKey(track, cat.category)
    openEntry = null
    if (openCategory === key) {
      openCategory = null
      return
    }
    categoryDrafts[key] = {
      title: cat.categoryOverride?.title ?? '',
      description: cat.categoryOverride?.description ?? '',
      isHidden: cat.isHidden,
    }
    openCategory = key
  }

  function toggleEntry(track: string, category: string, entry: Entry) {
    const key = entryKeyOf(track, category, entry.entryKey)
    if (openEntry === key) {
      openEntry = null
      return
    }
    const o = entry.override
    entryDrafts[key] = {
      valueText: o?.value_text ?? '',
      unit: o?.unit ?? '',
      profileId: o?.profile_id ?? '',
      playerName: o?.player_name ?? '',
      teamId: o?.team_id ?? '',
    }
    openEntry = key
  }

  async function load() {
    try {
      const result = await adminJsonRequest<{ tracks?: Track[] }>('/api/admin/stat-records', {
        fallbackMessage: 'Failed to load stat records',
      })
      tracks = result.tracks ?? []
      loadError = null
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to load stat records'
    } finally {
      loaded = true
    }
  }

  /** Run a write, reload, and report — every action in the editor goes through here. */
  async function run(key: string, done: string, request: () => Promise<unknown>) {
    busy = key
    message = null
    try {
      await request()
      await load()
      message = done
    } catch (err) {
      message = err instanceof Error ? err.message : 'Something went wrong'
    } finally {
      busy = null
    }
  }

  function put(body: Record<string, unknown>) {
    return adminJsonRequest('/api/admin/stat-records', {
      method: 'PUT',
      body,
      fallbackMessage: 'Failed to save the edit',
    })
  }

  function remove(track: string, category: string, entryKey = '') {
    const params = new URLSearchParams({ track, category, entryKey })
    return adminJsonRequest(`/api/admin/stat-records?${params}`, {
      method: 'DELETE',
      fallbackMessage: 'Failed to reset',
    })
  }

  function saveCategory(track: string, category: string) {
    const key = categoryKey(track, category)
    return run(key, 'Category saved.', () => put({ track, category, ...categoryDrafts[key] }))
  }

  function saveEntry(track: string, category: string, entry: Entry) {
    const key = entryKeyOf(track, category, entry.entryKey)
    return run(key, 'Correction saved.', async () => {
      await put({
        track,
        category,
        entryKey: entry.entryKey,
        label: label(entry),
        ...entryDrafts[key],
      })
      openEntry = null
    })
  }

  function hideEntry(track: string, category: string, entry: Entry) {
    const key = entryKeyOf(track, category, entry.entryKey)
    return run(key, 'Hidden. The next performance moved up into the top 5.', async () => {
      const o = entry.override
      await put({
        track,
        category,
        entryKey: entry.entryKey,
        label: label(entry),
        isHidden: true,
        valueText: o?.value_text,
        unit: o?.unit,
        profileId: o?.profile_id,
        playerName: o?.player_name,
        teamId: o?.team_id,
      })
      openEntry = null
    })
  }

  async function rebuild() {
    rebuilding = true
    message = null
    try {
      const result = await adminJsonRequest<{ recordCount?: number }>(
        '/api/admin/stat-records/rebuild',
        { method: 'POST', fallbackMessage: 'Rebuild failed' }
      )
      await load()
      message = `Rebuilt ${result.recordCount ?? 0} record rows from the stats.`
    } catch (err) {
      message = err instanceof Error ? err.message : 'Rebuild failed'
    } finally {
      rebuilding = false
    }
  }

  onMount(load)
</script>

<section class="admin-bordered p-3">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <div
        class="text-sm font-semibold tracking-wide uppercase"
        style="color: rgba(255,255,255,0.8);"
      >
        Stat Records
      </div>
      <p class="mt-1 text-xs" style="color: rgba(255,255,255,0.6);">
        The top 5 in each category, pulled from match stats and rebuilt after every import. Edits
        are kept separately, so a rebuild never undoes them. Leave a field empty to use the stats.
      </p>
      {#if message}
        <p class="mt-1 text-xs" style="color: rgba(255,255,255,0.8);">{message}</p>
      {/if}
    </div>
    <button type="button" class="admin-btn text-sm" onclick={rebuild} disabled={rebuilding}>
      {rebuilding ? 'Rebuilding...' : 'Rebuild now'}
    </button>
  </div>

  {#if !loaded}
    <div class="py-8 text-center text-sm" style="color: rgba(255,255,255,0.72);">
      Loading records...
    </div>
  {:else if loadError}
    <div class="py-8 text-center text-sm" style="color: #fca5a5;">{loadError}</div>
  {:else}
    {#each tracks as track (track.key)}
      <div class="mt-4">
        <div
          class="mb-2 flex items-center gap-2 text-xs font-semibold"
          style="color: rgba(255,255,255,0.7);"
        >
          {track.label}
          {#if track.isDisplayed}
            <span class="badge badge-green">On Hall of Fame</span>
          {/if}
        </div>

        {#if track.categories.length === 0}
          <p class="py-3 text-xs" style="color: rgba(255,255,255,0.55);">
            No records yet. They appear once matches with stats are imported.
          </p>
        {:else}
          <div class="grid grid-cols-1 gap-1.5">
            {#each track.categories as cat (cat.category)}
              {@const cKey = categoryKey(track.key, cat.category)}
              {@const isOpen = openCategory === cKey}
              {@const cDraft = categoryDrafts[cKey]}
              {@const leader = cat.top[0]}
              {@const editedCount =
                cat.top.filter((e) => e.override).length + (cat.categoryOverride ? 1 : 0)}
              <article class="record-row">
                <button
                  type="button"
                  class="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-2.5 text-left text-sm"
                  onclick={() => toggleCategory(track.key, cat)}
                >
                  <span class="font-semibold" style:opacity={cat.isHidden ? 0.5 : 1}
                    >{cat.title}</span
                  >
                  {#if leader}
                    <span class="tabular-nums" style="color: #60a5fa;"
                      >{leader.value} {leader.unit}</span
                    >
                    <span style="color: rgba(255,255,255,0.7);">{holderName(leader)}</span>
                  {/if}
                  <span class="ml-auto flex gap-1.5">
                    {#if cat.isHidden}<span class="badge badge-muted">Hidden</span>{/if}
                    {#if editedCount > 0}<span class="badge badge-blue">{editedCount} edited</span
                      >{/if}
                    {#if cat.detachedEdits.some((o) => o.is_hidden)}
                      <span class="badge badge-muted">
                        {cat.detachedEdits.filter((o) => o.is_hidden).length} hidden
                      </span>
                    {/if}
                  </span>
                </button>

                {#if isOpen && cDraft}
                  <div
                    class="grid grid-cols-1 gap-3 border-t p-2.5"
                    style="border-color: rgba(255,255,255,0.08);"
                  >
                    <!-- Category-wide -->
                    <div class="grid grid-cols-1 gap-2">
                      <div class="sub-heading">Category</div>
                      <input
                        class="admin-input"
                        value={cDraft.title}
                        placeholder={`Title: ${cat.defaultTitle}`}
                        oninput={(e) =>
                          (categoryDrafts[cKey] = { ...cDraft, title: e.currentTarget.value })}
                      />
                      <textarea
                        rows="2"
                        class="admin-input leading-5"
                        value={cDraft.description}
                        placeholder="Description shown on the card (optional)"
                        oninput={(e) =>
                          (categoryDrafts[cKey] = {
                            ...cDraft,
                            description: e.currentTarget.value,
                          })}
                      ></textarea>
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <label
                          class="inline-flex items-center gap-2 text-sm"
                          style="color: rgba(255,255,255,0.82);"
                        >
                          <input
                            type="checkbox"
                            checked={cDraft.isHidden}
                            onchange={(e) =>
                              (categoryDrafts[cKey] = {
                                ...cDraft,
                                isHidden: e.currentTarget.checked,
                              })}
                          />
                          Hide this category from the Hall of Fame
                        </label>
                        <div class="flex gap-2">
                          {#if cat.categoryOverride}
                            <button
                              type="button"
                              class="admin-btn admin-btn-sm admin-btn-neutral"
                              disabled={busy === cKey}
                              onclick={() =>
                                run(cKey, 'Category reset to the stats.', () =>
                                  remove(track.key, cat.category)
                                )}
                            >
                              Reset
                            </button>
                          {/if}
                          <button
                            type="button"
                            class="admin-btn admin-btn-sm admin-btn-go"
                            disabled={busy === cKey}
                            onclick={() => saveCategory(track.key, cat.category)}
                          >
                            Save category
                          </button>
                        </div>
                      </div>
                    </div>

                    <!-- Top 5 -->
                    <div class="grid grid-cols-1 gap-1">
                      <div class="sub-heading">Top {cat.top.length}</div>
                      {#each cat.top as entry (entry.entryKey)}
                        {@const eKey = entryKeyOf(track.key, cat.category, entry.entryKey)}
                        {@const eDraft = entryDrafts[eKey]}
                        <div class="entry-row">
                          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            <span class="rank">#{entry.rank}</span>
                            <span class="tabular-nums" style="color: #93c5fd;"
                              >{entry.value} {entry.unit}</span
                            >
                            <span>{holderName(entry)}</span>
                            {#if entry.mapName}
                              <span style="color: rgba(255,255,255,0.5);">{entry.mapName}</span>
                            {/if}
                            {#if entry.override}<span class="badge badge-blue">Edited</span>{/if}
                            <span class="ml-auto flex gap-1.5">
                              <button
                                type="button"
                                class="admin-btn admin-btn-sm admin-btn-info"
                                onclick={() => toggleEntry(track.key, cat.category, entry)}
                              >
                                {openEntry === eKey ? 'Close' : 'Edit'}
                              </button>
                              <button
                                type="button"
                                class="admin-btn admin-btn-sm admin-btn-warn"
                                disabled={busy === eKey}
                                title="Take this performance out of the rankings — the next one moves up"
                                onclick={() => hideEntry(track.key, cat.category, entry)}
                              >
                                Hide
                              </button>
                            </span>
                          </div>

                          {#if openEntry === eKey && eDraft}
                            <div class="mt-2 grid grid-cols-1 gap-2">
                              <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                <input
                                  class="admin-input"
                                  value={eDraft.valueText}
                                  placeholder={`Value: ${entry.stats.value}`}
                                  oninput={(e) =>
                                    (entryDrafts[eKey] = {
                                      ...eDraft,
                                      valueText: e.currentTarget.value,
                                    })}
                                />
                                <input
                                  class="admin-input"
                                  value={eDraft.unit}
                                  placeholder={`Unit: ${entry.stats.unit}`}
                                  oninput={(e) =>
                                    (entryDrafts[eKey] = {
                                      ...eDraft,
                                      unit: e.currentTarget.value,
                                    })}
                                />
                                {#if cat.holderKind === 'player'}
                                  <div>
                                    <CustomSelect
                                      options={playerChoices}
                                      value={eDraft.profileId}
                                      compact={true}
                                      placeholder={`Player: ${entry.stats.holder ?? '—'}`}
                                      onSelect={(value) =>
                                        (entryDrafts[eKey] = { ...eDraft, profileId: value })}
                                    />
                                  </div>
                                  <input
                                    class="admin-input"
                                    value={eDraft.playerName}
                                    placeholder="Or type a name"
                                    oninput={(e) =>
                                      (entryDrafts[eKey] = {
                                        ...eDraft,
                                        playerName: e.currentTarget.value,
                                      })}
                                  />
                                {/if}
                              </div>
                              <div class="flex flex-wrap items-center justify-between gap-2">
                                <div class="w-full sm:w-64">
                                  <CustomSelect
                                    options={teamChoices}
                                    value={eDraft.teamId}
                                    compact={true}
                                    placeholder={`Team: ${entry.stats.team ?? '—'}`}
                                    onSelect={(value) =>
                                      (entryDrafts[eKey] = { ...eDraft, teamId: value })}
                                  />
                                </div>
                                <div class="flex gap-2">
                                  {#if entry.override}
                                    <button
                                      type="button"
                                      class="admin-btn admin-btn-sm admin-btn-neutral"
                                      disabled={busy === eKey}
                                      onclick={() =>
                                        run(eKey, 'Reset to the stats.', async () => {
                                          await remove(track.key, cat.category, entry.entryKey)
                                          openEntry = null
                                        })}
                                    >
                                      Reset to stats
                                    </button>
                                  {/if}
                                  <button
                                    type="button"
                                    class="admin-btn admin-btn-sm admin-btn-go"
                                    disabled={busy === eKey}
                                    onclick={() => saveEntry(track.key, cat.category, entry)}
                                  >
                                    {busy === eKey ? 'Saving...' : 'Save'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          {/if}
                        </div>
                      {/each}
                    </div>

                    <!-- Hidden performances and corrections that no longer apply -->
                    {#if cat.detachedEdits.length > 0}
                      <div class="grid grid-cols-1 gap-1">
                        <div class="sub-heading">Hidden / no longer in the top 5</div>
                        {#each cat.detachedEdits as edit (edit.entry_key)}
                          {@const dKey = entryKeyOf(track.key, cat.category, edit.entry_key)}
                          <div
                            class="entry-row flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                          >
                            <span class="badge {edit.is_hidden ? 'badge-muted' : 'badge-amber'}">
                              {edit.is_hidden ? 'Hidden' : 'Outdated'}
                            </span>
                            <span style="color: rgba(255,255,255,0.75);">
                              {edit.label ?? 'A performance no longer in the stats'}
                            </span>
                            <button
                              type="button"
                              class="admin-btn admin-btn-sm admin-btn-neutral ml-auto"
                              disabled={busy === dKey}
                              title={edit.is_hidden
                                ? 'Put this performance back in the rankings'
                                : 'This correction was for a performance that left the top 5 or was re-imported'}
                              onclick={() =>
                                run(dKey, edit.is_hidden ? 'Unhidden.' : 'Removed.', () =>
                                  remove(track.key, cat.category, edit.entry_key)
                                )}
                            >
                              {edit.is_hidden ? 'Unhide' : 'Remove'}
                            </button>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</section>

<style>
  .record-row {
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.375rem;
    background: rgba(0, 0, 0, 0.18);
  }

  .record-row > button {
    cursor: pointer;
  }

  .entry-row {
    padding: 0.5rem 0.625rem;
    border-radius: 0.375rem;
    background: rgba(255, 255, 255, 0.03);
  }

  .sub-heading {
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
  }

  .rank {
    min-width: 1.75rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.55);
    font-variant-numeric: tabular-nums;
  }

  .badge {
    border-radius: 0.25rem;
    padding: 0.125rem 0.375rem;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .badge-green {
    background: rgba(52, 211, 153, 0.16);
    color: #6ee7b7;
  }

  .badge-blue {
    background: rgba(96, 165, 250, 0.16);
    color: #93c5fd;
  }

  .badge-muted {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
  }

  .badge-amber {
    background: rgba(251, 191, 36, 0.16);
    color: #fcd34d;
  }
</style>
