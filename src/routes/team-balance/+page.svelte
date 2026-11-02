<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import { CheckCircle, XCircle, Users, RotateCcw, Search, AlertCircle } from 'lucide-svelte'
  import { enhance } from '$app/forms'
  import { TEAM_CAP_LIMIT } from '$lib/team-balance'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()

  type RatedPlayer = {
    profileId: string
    name: string
    riotId: string | null
    riotIds: string[]
    rank: string | null
    value: number
    isManual: boolean
  }

  const ratedPlayers = $derived((data.ratedPlayers ?? []) as RatedPlayer[])
  const hasRoster = $derived(ratedPlayers.length > 0)
  const season = $derived(data.season)
  const maxAverage = $derived(data.cap.maxAverage)
  const isAdmin = $derived(data.user?.role === 'admin')

  let savingCap = $state(false)

  const nameKey = (name: string) => name.trim().toLowerCase()

  /**
   * Case-insensitive lookup by display name or any approved Riot ID (with or
   * without the tag). Display names win over Riot IDs where they collide.
   */
  const ratedByName = $derived.by(() => {
    const map = new Map<string, RatedPlayer>()
    for (const p of ratedPlayers) {
      for (const id of [p.riotId, ...p.riotIds]) {
        if (!id) continue
        const key = nameKey(id)
        if (!map.has(key)) map.set(key, p)
        const bare = key.split('#')[0]
        if (bare && !map.has(bare)) map.set(bare, p)
      }
    }
    for (const p of ratedPlayers) map.set(nameKey(p.name), p)
    return map
  })

  const ROSTER_SIZE = 5
  const blankRoster = () => Array.from({ length: ROSTER_SIZE }, () => '')

  /** Each slot holds just a typed name — the value comes from their signup. */
  let names: string[] = $state(blankRoster())

  function matchedPlayer(name: string): RatedPlayer | null {
    const key = nameKey(name)
    if (!key) return null
    return ratedByName.get(key) ?? null
  }

  /** The slot whose suggestion dropdown is showing, and the option highlighted in it. */
  let openSlot: number | null = $state(null)
  let highlighted = $state(0)

  const MAX_SUGGESTIONS = 8

  /** A row that has text typed but resolves to nobody, once suggestions run out. */
  function isUnknown(index: number) {
    const name = names[index]
    if (name.trim().length === 0 || matchedPlayer(name) !== null) return false
    return openSlot !== index || suggestionsFor(index).length === 0
  }

  const matchedRoster = $derived(
    names
      .map(matchedPlayer)
      .filter((p): p is RatedPlayer => p !== null)
      // The same player typed twice (say by name and by Riot ID) counts once.
      .filter((p, i, all) => all.findIndex((q) => q.profileId === p.profileId) === i)
  )
  const unknownCount = $derived(names.filter((_, i) => isUnknown(i)).length)

  const totalValue = $derived(matchedRoster.reduce((sum, p) => sum + p.value, 0))
  const average = $derived(matchedRoster.length > 0 ? totalValue / matchedRoster.length : 0)
  const allFilled = $derived(matchedRoster.length === ROSTER_SIZE)
  const isEligible = $derived(allFilled && average <= maxAverage)

  /** Rating headroom left for the slots still empty. */
  const slotsLeft = $derived(ROSTER_SIZE - matchedRoster.length)
  const maxForNext = $derived(
    slotsLeft > 0 ? (maxAverage * ROSTER_SIZE - totalValue) / slotsLeft : 0
  )

  /** Players already picked, so the picker does not offer duplicates. */
  const usedIds = $derived(new Set(matchedRoster.map((p) => p.profileId)))

  function availableFor(index: number) {
    const own = matchedPlayer(names[index])?.profileId
    return ratedPlayers.filter((p) => p.profileId === own || !usedIds.has(p.profileId))
  }

  /** How well a player fits the typed text; lower is better, null is no match. */
  function matchScore(player: RatedPlayer, query: string) {
    const name = nameKey(player.name)
    const ids = [player.riotId, ...player.riotIds].filter((id) => id !== null).map(nameKey)
    if (name.startsWith(query)) return 0
    if (ids.some((id) => id.startsWith(query))) return 1
    if (name.includes(query) || ids.some((id) => id.includes(query))) return 2
    return null
  }

  /** Best matches for what is typed in a slot; the sort keeps same-score players by name. */
  function suggestionsFor(index: number) {
    const query = nameKey(names[index])
    if (!query) return []
    return availableFor(index)
      .map((player) => ({ player, score: matchScore(player, query) }))
      .filter((s): s is { player: RatedPlayer; score: number } => s.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_SUGGESTIONS)
      .map((s) => s.player)
  }

  function handleInput(index: number) {
    openSlot = index
    highlighted = 0
  }

  function pick(index: number, player: RatedPlayer) {
    // Two players can share a display name, so fall back to the Riot ID to keep the pick exact.
    names[index] =
      ratedByName.get(nameKey(player.name)) === player
        ? player.name
        : (player.riotId ?? player.name)
    openSlot = null
  }

  function handleKeydown(e: KeyboardEvent, index: number) {
    const suggestions = suggestionsFor(index)
    if (e.key === 'Escape') {
      openSlot = null
    } else if (suggestions.length === 0) {
      return
    } else if (openSlot !== index) {
      if (e.key === 'ArrowDown') handleInput(index)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      highlighted = (highlighted + 1) % suggestions.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      highlighted = (highlighted - 1 + suggestions.length) % suggestions.length
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(index, suggestions[highlighted])
    }
  }

  function clearAll() {
    names = blankRoster()
  }
</script>

<svelte:head><title>Team Balance Calculator</title></svelte:head>

<PageContainer>
  <div class="page-content-narrow py-6">
    <PageHeading
      title="Team Balance Calculator"
      subtitle={season
        ? `Add five players approved for ${season.name} to check the roster against the cap.`
        : 'Add five registered players to check the roster against the cap.'}
      icon={Users}
    />

    {#if data.cap.isDefault}
      <div class="notice">
        <AlertCircle size={16} style="flex-shrink: 0; margin-top: 1px;" />
        <div>
          <strong>Provisional cap.</strong>
          The team average cap hasn't been finalised — {maxAverage} is a placeholder and may change before
          the season starts.
        </div>
      </div>
    {/if}

    {#if isAdmin}
      <form
        class="cap-form"
        method="POST"
        action="?/setCap"
        use:enhance={({ formData, cancel }) => {
          const next = formData.get('maxAverage')
          const prompt = `Change the team average cap from ${maxAverage} to ${next}? This changes the cap for everyone.`
          if (!window.confirm(prompt)) {
            cancel()
            return
          }
          savingCap = true
          return async ({ update }) => {
            await update({ reset: false })
            savingCap = false
          }
        }}
      >
        <label class="cap-label" for="cap-input">Team average cap</label>
        <input
          id="cap-input"
          class="input cap-input"
          type="number"
          name="maxAverage"
          step="0.01"
          min="0.01"
          max={TEAM_CAP_LIMIT}
          required
          value={maxAverage}
        />
        <button type="submit" class="clear-btn" disabled={savingCap}>
          {savingCap ? 'Saving…' : 'Save cap'}
        </button>
        {#if form?.capError}
          <span class="cap-form-msg cap-over">{form.capError}</span>
        {:else if form?.capSaved}
          <span class="cap-form-msg cap-ok">Saved. This is now the cap for everyone.</span>
        {/if}
      </form>
    {/if}

    {#if !hasRoster}
      <div class="notice">
        <AlertCircle size={16} style="flex-shrink: 0; margin-top: 1px;" />
        <div>
          <strong>No rated players yet.</strong>
          Values come from approved signups. Once an admin approves players for
          {season ? season.name : 'the season taking signups'}, they'll be selectable here.
        </div>
      </div>
    {/if}

    <!-- Cap summary -->
    <div class="cap-bar">
      <div class="cap-item">
        <span class="cap-label">Team average</span>
        <span class="cap-value" class:cap-over={allFilled && !isEligible} class:cap-ok={isEligible}>
          {matchedRoster.length > 0 ? average.toFixed(2) : '—'}
        </span>
      </div>
      <div class="cap-divider"></div>
      <div class="cap-item">
        <span class="cap-label">Maximum</span>
        <span class="cap-value cap-muted">{maxAverage}</span>
      </div>
      <div class="cap-divider"></div>
      <div class="cap-item">
        <span class="cap-label">Players</span>
        <span class="cap-value cap-muted">{matchedRoster.length}/{ROSTER_SIZE}</span>
      </div>
      {#if slotsLeft > 0 && matchedRoster.length > 0}
        <div class="cap-divider"></div>
        <div class="cap-item">
          <span class="cap-label">Budget per empty slot</span>
          <span class="cap-value" class:cap-over={maxForNext < 0}>{maxForNext.toFixed(2)}</span>
        </div>
      {/if}
    </div>

    <!-- Verdict -->
    {#if allFilled}
      <div class="verdict" class:verdict-ok={isEligible} class:verdict-bad={!isEligible}>
        {#if isEligible}
          <CheckCircle size={20} />
          <span>
            <strong>Eligible.</strong> Average {average.toFixed(2)} is within the
            {maxAverage} cap.
          </span>
        {:else}
          <XCircle size={20} />
          <span>
            <strong>Over the cap.</strong> Average {average.toFixed(2)} exceeds
            {maxAverage} by {(average - maxAverage).toFixed(2)}.
          </span>
        {/if}
      </div>
    {/if}

    <!-- Roster -->
    <section class="roster">
      <div class="roster-head">
        <h2 class="roster-title">Roster</h2>
        {#if unknownCount > 0}
          <span class="roster-warn">
            <AlertCircle size={13} />
            {unknownCount}
            {unknownCount === 1 ? 'name is' : 'names are'} not a registered player
          </span>
        {/if}
      </div>

      <div class="rows">
        {#each names as name, i (i)}
          {@const matched = matchedPlayer(name)}
          {@const unknown = isUnknown(i)}
          {@const suggestions = openSlot === i ? suggestionsFor(i) : []}
          <div class="row" class:row-matched={matched} class:row-unknown={unknown}>
            <span class="row-num">{i + 1}</span>

            <div class="row-name">
              <input
                type="text"
                id="player-{i}"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={suggestions.length > 0}
                aria-controls="player-options-{i}"
                aria-activedescendant={suggestions.length > 0
                  ? `player-option-${i}-${highlighted}`
                  : undefined}
                autocomplete="off"
                bind:value={names[i]}
                oninput={() => handleInput(i)}
                onkeydown={(e) => handleKeydown(e, i)}
                onblur={() => (openSlot = null)}
                placeholder={hasRoster ? 'Search by name or Riot ID' : 'No players available'}
                disabled={!hasRoster}
                class="input"
              />

              {#if suggestions.length > 0}
                <div class="suggestions" id="player-options-{i}" role="listbox">
                  {#each suggestions as player, s (player.profileId)}
                    <button
                      type="button"
                      id="player-option-{i}-{s}"
                      class="suggestion"
                      class:suggestion-active={s === highlighted}
                      role="option"
                      aria-selected={s === highlighted}
                      tabindex="-1"
                      onmousedown={(e) => e.preventDefault()}
                      onmouseenter={() => (highlighted = s)}
                      onclick={() => pick(i, player)}
                    >
                      <span class="suggestion-text">
                        <span class="suggestion-name">{player.name}</span>
                        {#if player.riotId && player.riotId !== player.name}
                          <span class="suggestion-riot">{player.riotId}</span>
                        {/if}
                      </span>
                      <span class="suggestion-value">{player.value}</span>
                    </button>
                  {/each}
                </div>
              {/if}

              {#if !name}
                <span class="row-icon"><Search size={13} /></span>
              {:else if unknown}
                <span class="row-icon row-icon-warn"><AlertCircle size={14} /></span>
              {/if}
            </div>

            <div class="row-value">
              {#if matched}
                <span class="value-num">{matched.value}</span>
                {#if matched.isManual}
                  <span class="value-src">set by admin</span>
                {:else if matched.rank}
                  <span class="value-src">{matched.rank}</span>
                {/if}
              {:else if unknown}
                <span class="value-unknown">not found</span>
              {:else}
                <span class="value-empty">—</span>
              {/if}
            </div>

            <button
              type="button"
              class="row-clear"
              aria-label="Clear slot {i + 1}"
              disabled={!name}
              onclick={() => (names[i] = '')}
            >
              <XCircle size={14} />
            </button>
          </div>
        {/each}
      </div>

      <div class="roster-foot">
        <p class="foot-note">
          Each player's value is their signup score: current and peak rank plus a rating bonus, with
          any admin adjustment. Names that don't match a registered player are ignored in the
          average.
        </p>
        <button type="button" class="clear-btn" onclick={clearAll}>
          <RotateCcw size={13} /> Clear all
        </button>
      </div>
    </section>
  </div>
</PageContainer>

<style>
  .notice {
    display: flex;
    gap: 0.625rem;
    padding: 0.875rem 1.125rem;
    border-radius: 0.625rem;
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.28);
    color: #fde68a;
    font-size: 0.8125rem;
    line-height: 1.5;
    margin-bottom: 0.75rem;
  }

  /* Admin cap control */
  .cap-form {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.625rem;
    padding: 0.625rem 1.25rem;
    border-radius: 0.75rem;
    border: 1px dashed rgba(255, 255, 255, 0.14);
    margin-bottom: 0.75rem;
  }

  .cap-input {
    width: 6rem;
    padding-right: 0.5rem;
  }

  .cap-form-msg {
    font-size: 0.75rem;
  }

  /* Cap summary */
  .cap-bar {
    display: flex;
    align-items: stretch;
    flex-wrap: wrap;
    gap: 0.25rem;
    padding: 0.875rem 1.25rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.22);
    margin-bottom: 0.75rem;
  }

  .cap-item {
    display: flex;
    flex-direction: column;
    gap: 0.1875rem;
    padding: 0 0.875rem;
    flex: 1;
    min-width: 5.5rem;
  }

  .cap-divider {
    width: 1px;
    background: rgba(255, 255, 255, 0.08);
  }

  .cap-label {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.6);
  }

  .cap-value {
    font-size: 1.375rem;
    font-weight: 700;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }

  .cap-muted {
    color: rgba(255, 255, 255, 0.55);
  }

  .cap-ok {
    color: #4ade80;
  }

  .cap-over {
    color: #f87171;
  }

  /* Verdict */
  .verdict {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.75rem 1.125rem;
    border-radius: 0.625rem;
    font-size: 0.875rem;
    margin-bottom: 0.75rem;
  }

  .verdict-ok {
    background: rgba(74, 222, 128, 0.1);
    border: 1px solid rgba(74, 222, 128, 0.3);
    color: #bbf7d0;
  }

  .verdict-bad {
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.3);
    color: #fecaca;
  }

  /* Roster */
  .roster {
    padding: 1.25rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.2);
  }

  .roster-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 0.875rem;
    padding-bottom: 0.625rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .roster-title {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.64);
  }

  .roster-warn {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    font-size: 0.6875rem;
    color: #fcd34d;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .row {
    display: grid;
    grid-template-columns: 1.25rem minmax(0, 1fr) 7rem 1.5rem;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
    border-radius: 0.5rem;
    border: 1px solid transparent;
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  .row-matched {
    border-color: rgba(120, 67, 145, 0.3);
    background: rgba(120, 67, 145, 0.06);
  }

  .row-unknown {
    border-color: rgba(251, 191, 36, 0.25);
    background: rgba(251, 191, 36, 0.04);
  }

  .row-num {
    font-size: 0.75rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.52);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .row-name {
    position: relative;
    min-width: 0;
  }

  .input {
    width: 100%;
    padding: 0.5rem 2rem 0.5rem 0.75rem;
    border-radius: 0.4375rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.3);
    color: var(--text);
    font-size: 0.875rem;
  }

  .row-matched .input {
    border-color: rgba(120, 67, 145, 0.45);
    font-weight: 600;
  }

  .row-unknown .input {
    border-color: rgba(251, 191, 36, 0.35);
  }

  .input::placeholder {
    color: rgba(255, 255, 255, 0.5);
  }

  .input:focus {
    outline: none;
    border-color: var(--hover);
  }

  .input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .suggestions {
    position: absolute;
    top: calc(100% + 0.25rem);
    left: 0;
    right: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    padding: 0.25rem;
    border-radius: 0.4375rem;
    border: 1px solid var(--border);
    background: var(--background);
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
  }

  .suggestion {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.4375rem 0.625rem;
    border: none;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }

  .suggestion-active {
    background: var(--hover);
  }

  .suggestion-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .suggestion-name,
  .suggestion-riot {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .suggestion-name {
    font-size: 0.875rem;
    font-weight: 600;
  }

  .suggestion-riot {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .suggestion-value {
    font-size: 0.875rem;
    font-weight: 700;
    color: #d8b4fe;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .suggestion-active .suggestion-value {
    color: var(--text);
  }

  .row-icon {
    position: absolute;
    top: 50%;
    right: 0.625rem;
    transform: translateY(-50%);
    color: rgba(255, 255, 255, 0.45);
    pointer-events: none;
    display: flex;
  }

  .row-icon-warn {
    color: #fcd34d;
  }

  .row-value {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.0625rem;
    line-height: 1.1;
  }

  .value-num {
    font-size: 1.125rem;
    font-weight: 700;
    color: #d8b4fe;
    font-variant-numeric: tabular-nums;
  }

  .value-src {
    font-size: 0.5625rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.52);
  }

  .value-unknown {
    font-size: 0.6875rem;
    color: #fcd34d;
  }

  .value-empty {
    font-size: 1.125rem;
    color: rgba(255, 255, 255, 0.45);
  }

  .row-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    color: rgba(255, 255, 255, 0.45);
    cursor: pointer;
    transition: color 0.15s;
  }

  .row-clear:hover:not(:disabled) {
    color: #f87171;
  }

  .row-clear:disabled {
    opacity: 0.25;
    cursor: default;
  }

  .roster-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 1rem;
    padding-top: 0.875rem;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
  }

  .foot-note {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.58);
    line-height: 1.5;
    max-width: 44ch;
  }

  .clear-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    padding: 0.4375rem 0.875rem;
    border-radius: 0.4375rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .clear-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .clear-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }

  @media (max-width: 640px) {
    .cap-bar {
      padding: 0.75rem 0.5rem;
    }

    .cap-item {
      padding: 0 0.5rem;
      min-width: 4.5rem;
    }

    .cap-value {
      font-size: 1.125rem;
    }

    .cap-divider {
      display: none;
    }

    .roster {
      padding: 0.875rem;
    }

    .row {
      grid-template-columns: 1.25rem minmax(0, 1fr) 4.5rem 1.25rem;
      gap: 0.5rem;
    }

    .roster-foot {
      flex-direction: column;
      align-items: stretch;
    }

    .foot-note {
      max-width: none;
    }
  }
</style>
