<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { CheckCircle, XCircle, RotateCcw, Search, AlertCircle } from 'lucide-svelte'
  import { enhance } from '$app/forms'
  import { browser } from '$app/environment'
  import { IMMORTAL_CAP_LIMIT, TEAM_CAP_LIMIT } from '$lib/team-balance'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()

  type RatedPlayer = {
    profileId: string
    name: string
    riotId: string | null
    riotIds: string[]
    rank: string | null
    /** Peaked Immortal or Radiant: counts toward the Immortal-peak total. */
    immortalPeak: boolean
    value: number
    isManual: boolean
    /** Only admins are sent pending signups. */
    isPending: boolean
  }

  const PENDING_KEY = 'team-balance:include-pending'

  /** Admin-only: let signups still awaiting review into the calculator. Remembered per browser. */
  let includePending = $state(readIncludePending())

  function readIncludePending() {
    if (!browser) return false
    try {
      return localStorage.getItem(PENDING_KEY) === '1'
    } catch {
      return false
    }
  }

  $effect(() => {
    try {
      localStorage.setItem(PENDING_KEY, includePending ? '1' : '0')
    } catch {
      // Storage can be blocked; the toggle still works for this visit.
    }
  })

  const allPlayers = $derived((data.ratedPlayers ?? []) as RatedPlayer[])
  const pendingCount = $derived(allPlayers.filter((p) => p.isPending).length)
  const ratedPlayers = $derived(
    includePending ? allPlayers : allPlayers.filter((p) => !p.isPending)
  )
  const hasRoster = $derived(ratedPlayers.length > 0)
  const season = $derived(data.season)
  /** Null for non-admins until the season is marked active. */
  const cap = $derived(data.cap)
  const maxAverage = $derived(cap?.maxAverage ?? 0)
  const maxImmortalTotal = $derived(cap?.maxImmortalTotal ?? 0)
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
  const pendingInRoster = $derived(matchedRoster.some((p) => p.isPending))
  const unknownCount = $derived(names.filter((_, i) => isUnknown(i)).length)

  const totalValue = $derived(matchedRoster.reduce((sum, p) => sum + p.value, 0))
  const average = $derived(matchedRoster.length > 0 ? totalValue / matchedRoster.length : 0)
  const allFilled = $derived(matchedRoster.length === ROSTER_SIZE)

  /** Combined score of the roster's Immortal-peak players, which has its own cap. */
  const immortalPlayers = $derived(matchedRoster.filter((p) => p.immortalPeak))
  const immortalTotal = $derived(immortalPlayers.reduce((sum, p) => sum + p.value, 0))
  // Rounded like the stored values, so 65.00 against a 65 cap is not over by float noise.
  const immortalOver = $derived(
    cap !== null && Math.round(immortalTotal * 100) > Math.round(maxImmortalTotal * 100)
  )
  const averageOver = $derived(cap !== null && average > maxAverage)
  const isEligible = $derived(cap !== null && allFilled && !averageOver && !immortalOver)

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
    <div class="sheet tb-sheet">
      <header class="tb-head">
        <h1 class="tb-title">Team Balance</h1>
        <p class="tb-sub">
          {season
            ? `Add five players approved for ${season.name} to check the roster against the cap.`
            : 'Add five registered players to check the roster against the cap.'}
        </p>
      </header>

      {#if !cap}
        <div class="tb-notice">
          <AlertCircle size={15} class="tb-notice-icon" />
          <p>
            <strong>Cap not announced yet.</strong>
            The team average cap will be shown here once the season starts. You can still build a roster
            and see its average.
          </p>
        </div>
      {:else if cap.isDefault}
        <div class="tb-notice">
          <AlertCircle size={15} class="tb-notice-icon" />
          <p>
            <strong>Provisional cap.</strong>
            The team average cap hasn't been finalised — {maxAverage} is a placeholder and may change
            before the season starts.
          </p>
        </div>
      {/if}

      {#if isAdmin && includePending && pendingInRoster}
        <div class="tb-notice">
          <AlertCircle size={15} class="tb-notice-icon" />
          <p>
            <strong>Pending players in this roster.</strong>
            Their values may change on review, and players can't select them until they're approved.
          </p>
        </div>
      {/if}

      {#if !hasRoster}
        <div class="tb-notice">
          <AlertCircle size={15} class="tb-notice-icon" />
          <p>
            <strong>No rated players yet.</strong>
            Values come from approved signups. Once an admin approves players for
            {season ? season.name : 'the season taking signups'}, they'll be selectable here.
          </p>
        </div>
      {/if}

      <!-- Cap summary -->
      <section class="tb-summary" aria-label="Roster summary">
        <div class="tb-stats">
          <div class="tb-stat">
            <span class="tb-stat-label">Team average</span>
            <span
              class="tb-stat-value"
              class:tb-over={cap && allFilled && !isEligible}
              class:tb-ok={isEligible}
            >
              {matchedRoster.length > 0 ? average.toFixed(2) : '—'}
            </span>
          </div>
          {#if cap}
            <div class="tb-stat">
              <span class="tb-stat-label">Cap</span>
              <span class="tb-stat-value tb-muted">{maxAverage}</span>
            </div>
            <div class="tb-stat">
              <span class="tb-stat-label">Immortal peaks</span>
              <span
                class="tb-stat-value"
                class:tb-over={immortalOver}
                class:tb-muted={!immortalOver}
              >
                {immortalTotal.toFixed(2)} / {maxImmortalTotal}
              </span>
            </div>
          {/if}
          <div class="tb-stat">
            <span class="tb-stat-label">Players</span>
            <span class="tb-stat-value tb-muted">{matchedRoster.length}/{ROSTER_SIZE}</span>
          </div>
          {#if cap && slotsLeft > 0 && matchedRoster.length > 0}
            <div class="tb-stat">
              <span class="tb-stat-label">Budget per empty slot</span>
              <span class="tb-stat-value" class:tb-over={maxForNext < 0}
                >{maxForNext.toFixed(2)}</span
              >
            </div>
          {/if}
        </div>

        {#if cap && allFilled}
          <div
            class="tb-verdict"
            class:tb-verdict-ok={isEligible}
            class:tb-verdict-bad={!isEligible}
          >
            {#if isEligible}
              <CheckCircle size={16} />
              <span>
                <strong>Eligible.</strong> Average {average.toFixed(2)} is within the
                {maxAverage} cap.
              </span>
            {:else}
              <XCircle size={16} />
              <span>
                <strong>Over the cap.</strong>
                {#if averageOver}
                  Average {average.toFixed(2)} exceeds {maxAverage} by
                  {(average - maxAverage).toFixed(2)}.
                {/if}
                {#if immortalOver}
                  Immortal-peak players total {immortalTotal.toFixed(2)}, over the
                  {maxImmortalTotal} limit by {(immortalTotal - maxImmortalTotal).toFixed(2)}.
                {/if}
              </span>
            {/if}
          </div>
        {/if}
      </section>

      <!-- Roster -->
      <section class="sheet-section">
        <div class="sheet-head">
          <h2 class="sheet-title">Roster</h2>
          {#if unknownCount > 0}
            <span class="tb-warn">
              <AlertCircle size={12} />
              {unknownCount}
              {unknownCount === 1 ? 'name is' : 'names are'} not a registered player
            </span>
          {/if}
        </div>

        <div class="sheet-body">
          <div class="tb-rows">
            {#each names as name, i (i)}
              {@const matched = matchedPlayer(name)}
              {@const unknown = isUnknown(i)}
              {@const suggestions = openSlot === i ? suggestionsFor(i) : []}
              <div class="tb-row" class:tb-row-matched={matched} class:tb-row-unknown={unknown}>
                <span class="tb-row-num">{i + 1}</span>

                <div class="tb-row-name">
                  <input
                    type="text"
                    id="player-{i}"
                    role="combobox"
                    aria-label="Player {i + 1}"
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
                    class="tb-input"
                  />

                  {#if suggestions.length > 0}
                    <div class="tb-suggestions" id="player-options-{i}" role="listbox">
                      {#each suggestions as player, s (player.profileId)}
                        <button
                          type="button"
                          id="player-option-{i}-{s}"
                          class="tb-suggestion"
                          class:tb-suggestion-active={s === highlighted}
                          role="option"
                          aria-selected={s === highlighted}
                          tabindex="-1"
                          onmousedown={(e) => e.preventDefault()}
                          onmouseenter={() => (highlighted = s)}
                          onclick={() => pick(i, player)}
                        >
                          <span class="tb-suggestion-text">
                            <span class="tb-suggestion-name"
                              >{player.name}
                              {#if player.isPending}<span class="tb-pending-tag">pending</span
                                >{/if}</span
                            >
                            {#if player.riotId && player.riotId !== player.name}
                              <span class="tb-suggestion-riot">{player.riotId}</span>
                            {/if}
                          </span>
                          <span class="tb-suggestion-value">{player.value}</span>
                        </button>
                      {/each}
                    </div>
                  {/if}

                  {#if !name}
                    <span class="tb-row-icon"><Search size={13} /></span>
                  {:else if unknown}
                    <span class="tb-row-icon tb-row-icon-warn"><AlertCircle size={14} /></span>
                  {/if}
                </div>

                <div class="tb-row-value">
                  {#if matched}
                    <span class="tb-value-num">{matched.value}</span>
                    {#if matched.immortalPeak}
                      <span class="tb-value-src tb-imm-src" title="Peaked Immortal or Radiant"
                        >Imm peak</span
                      >
                    {/if}
                    {#if matched.isPending}
                      <span class="tb-value-src tb-pending-src">pending</span>
                    {:else if matched.isManual}
                      <span class="tb-value-src">set by admin</span>
                    {:else if matched.rank}
                      <span class="tb-value-src">{matched.rank}</span>
                    {/if}
                  {:else if unknown}
                    <span class="tb-value-unknown">not found</span>
                  {:else}
                    <span class="tb-value-empty">—</span>
                  {/if}
                </div>

                <button
                  type="button"
                  class="tb-row-clear"
                  aria-label="Clear slot {i + 1}"
                  disabled={!name}
                  onclick={() => (names[i] = '')}
                >
                  <XCircle size={14} />
                </button>
              </div>
            {/each}
          </div>
        </div>
      </section>

      <footer class="tb-foot">
        <p class="tb-foot-note">
          Each player's value is their signup score: current and peak rank plus a bonus for how they
          played against players of their rank in past seasons, with any admin adjustment. Players
          who peaked Immortal or Radiant also count toward the Immortal-peak limit. Names that don't
          match a registered player are ignored.
        </p>
        <button type="button" class="tb-btn" onclick={clearAll}>
          <RotateCcw size={13} /> Clear all
        </button>
      </footer>

      {#if isAdmin}
        <section class="sheet-section tb-admin">
          <div class="sheet-head">
            <h2 class="sheet-title">Admin</h2>
            <span class="sheet-note">Changes the caps for everyone</span>
          </div>
          <div class="sheet-body tb-admin-body">
            <label class="tb-toggle">
              <input type="checkbox" bind:checked={includePending} />
              <span>
                Include pending players
                <span class="tb-toggle-note">
                  {pendingCount}
                  {pendingCount === 1 ? 'signup awaits' : 'signups await'} review · only you see this
                </span>
              </span>
            </label>
            <form
              class="tb-cap-form"
              method="POST"
              action="?/setCap"
              use:enhance={({ formData, cancel }) => {
                const next = formData.get('maxAverage')
                const nextImmortal = formData.get('maxImmortalTotal')
                const prompt = `Set the team average cap to ${next} (was ${maxAverage}) and the Immortal-peak limit to ${nextImmortal} (was ${maxImmortalTotal})? This changes the caps for everyone.`
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
              <label class="tb-cap-label" for="cap-input">Team average cap</label>
              <input
                id="cap-input"
                class="tb-input tb-cap-input"
                type="number"
                name="maxAverage"
                step="0.01"
                min="0.01"
                max={TEAM_CAP_LIMIT}
                required
                value={maxAverage}
              />
              <label class="tb-cap-label" for="imm-cap-input">Immortal-peak limit</label>
              <input
                id="imm-cap-input"
                class="tb-input tb-cap-input"
                type="number"
                name="maxImmortalTotal"
                step="0.01"
                min="0.01"
                max={IMMORTAL_CAP_LIMIT}
                required
                value={maxImmortalTotal}
              />
              <button type="submit" class="tb-btn" disabled={savingCap}>
                {savingCap ? 'Saving…' : 'Save caps'}
              </button>
              {#if form?.capError}
                <span class="tb-cap-msg tb-over">{form.capError}</span>
              {:else if form?.capSaved}
                <span class="tb-cap-msg tb-ok">Saved. These are now the caps for everyone.</span>
              {/if}
            </form>
          </div>
        </section>
      {/if}
    </div>
  </div>
</PageContainer>

<style>
  /* The suggestion dropdowns hang below their row, so the sheet must not clip
     them; the header band rounds its own top corners instead. */
  .tb-sheet {
    overflow: visible;
  }

  .tb-head {
    background: rgba(255, 255, 255, 0.025);
    border-radius: 0.875rem 0.875rem 0 0;
    padding: 1.375rem 1.5rem 1.125rem;
  }

  .tb-title {
    margin: 0;
    font-size: 1.625rem;
    font-weight: 700;
    line-height: 1.2;
    color: var(--title);
  }

  .tb-sub {
    margin-top: 0.25rem;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.64);
  }

  /* Notices sit flush in the sheet as a tinted band, not a floating card. */
  .tb-notice {
    display: flex;
    gap: 0.625rem;
    padding: 0.75rem 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(251, 191, 36, 0.06);
    box-shadow: inset 2px 0 0 rgba(251, 191, 36, 0.6);
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--gold-text);
  }

  .tb-notice strong {
    font-weight: 700;
  }

  :global(.tb-notice-icon) {
    flex-shrink: 0;
    margin-top: 2px;
  }

  /* Summary strip */
  .tb-summary {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .tb-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  }

  .tb-stat {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 1rem 1.5rem;
  }

  .tb-stat + .tb-stat {
    border-left: 1px solid rgba(255, 255, 255, 0.06);
  }

  .tb-stat-label {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.5);
  }

  .tb-stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.1;
    color: var(--heading);
    font-variant-numeric: tabular-nums;
  }

  .tb-muted {
    color: rgba(255, 255, 255, 0.6);
  }

  .tb-ok {
    color: var(--good);
  }

  .tb-over {
    color: var(--bad);
  }

  .tb-verdict {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 0.8125rem;
  }

  .tb-verdict-ok {
    background: rgba(74, 222, 128, 0.07);
    color: #bbf7d0;
  }

  .tb-verdict-bad {
    background: rgba(248, 113, 113, 0.07);
    color: #fecaca;
  }

  /* Roster */
  .tb-warn {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    margin-left: auto;
    font-size: 0.6875rem;
    color: var(--gold);
  }

  .tb-rows {
    display: flex;
    flex-direction: column;
  }

  .tb-row {
    position: relative;
    display: grid;
    grid-template-columns: 1.25rem minmax(0, 1fr) 7rem 1.5rem;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0;
  }

  .tb-row + .tb-row {
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  /* A slim accent at the left edge marks a filled or unknown slot. */
  .tb-row::before {
    content: '';
    position: absolute;
    left: -1.5rem;
    top: 0.5rem;
    bottom: 0.5rem;
    width: 2px;
    border-radius: 0 2px 2px 0;
    background: transparent;
  }

  .tb-row-matched::before {
    background: rgba(192, 132, 252, 0.7);
  }

  .tb-row-unknown::before {
    background: rgba(251, 191, 36, 0.7);
  }

  .tb-row-num {
    font-size: 0.75rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.45);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .tb-row-matched .tb-row-num {
    color: var(--accent-text);
  }

  .tb-row-name {
    position: relative;
    min-width: 0;
  }

  .tb-input {
    width: 100%;
    padding: 0.5rem 2rem 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.22);
    color: var(--text);
    font-size: 0.875rem;
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  .tb-row-matched .tb-input {
    border-color: transparent;
    background: rgba(255, 255, 255, 0.03);
    font-weight: 600;
  }

  .tb-row-unknown .tb-input {
    border-color: rgba(251, 191, 36, 0.35);
  }

  .tb-input::placeholder {
    color: rgba(255, 255, 255, 0.45);
  }

  .tb-input:focus,
  .tb-row-matched .tb-input:focus {
    outline: none;
    border-color: rgba(192, 132, 252, 0.6);
    background: rgba(0, 0, 0, 0.22);
  }

  .tb-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tb-suggestions {
    position: absolute;
    top: calc(100% + 0.25rem);
    left: 0;
    right: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    padding: 0.25rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: #24153b;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
  }

  .tb-suggestion {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.4375rem 0.625rem;
    border: none;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }

  .tb-suggestion-active {
    background: rgba(192, 132, 252, 0.16);
  }

  .tb-suggestion-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .tb-suggestion-name,
  .tb-suggestion-riot {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tb-suggestion-name {
    font-size: 0.875rem;
    font-weight: 600;
  }

  .tb-suggestion-riot {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .tb-suggestion-value {
    font-size: 0.875rem;
    font-weight: 700;
    color: #d8b4fe;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .tb-row-icon {
    position: absolute;
    top: 50%;
    right: 0.625rem;
    transform: translateY(-50%);
    color: rgba(255, 255, 255, 0.4);
    pointer-events: none;
    display: flex;
  }

  .tb-row-icon-warn {
    color: var(--gold);
  }

  .tb-row-value {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.125rem;
    line-height: 1.1;
  }

  .tb-value-num {
    font-size: 1.125rem;
    font-weight: 700;
    color: #d8b4fe;
    font-variant-numeric: tabular-nums;
  }

  .tb-value-src {
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.5);
  }

  .tb-value-unknown {
    font-size: 0.6875rem;
    color: var(--gold);
  }

  .tb-value-empty {
    font-size: 1.125rem;
    color: rgba(255, 255, 255, 0.35);
  }

  .tb-row-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    color: rgba(255, 255, 255, 0.42);
    cursor: pointer;
    transition: color 0.15s;
  }

  .tb-row-clear:hover:not(:disabled) {
    color: var(--bad);
  }

  .tb-row-clear:disabled {
    opacity: 0.25;
    cursor: default;
  }

  /* Footer band */
  .tb-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.875rem 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.025);
  }

  /* With no admin section below, the footer is the sheet's last band. */
  .tb-foot:last-child {
    border-radius: 0 0 0.875rem 0.875rem;
  }

  .tb-foot-note {
    font-size: 0.6875rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.56);
    max-width: 52ch;
  }

  .tb-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    flex-shrink: 0;
    min-height: 2.25rem;
    padding: 0 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .tb-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
  }

  .tb-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* Admin controls */
  .tb-admin-body {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  .tb-toggle {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.75);
    cursor: pointer;
  }

  .tb-toggle input {
    margin-top: 0.125rem;
    accent-color: #c084fc;
  }

  .tb-toggle-note {
    display: block;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.5);
  }

  .tb-pending-tag {
    margin-left: 0.375rem;
    padding: 0 0.3125rem;
    border-radius: 0.25rem;
    background: rgba(251, 191, 36, 0.14);
    color: var(--gold);
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    vertical-align: middle;
  }

  .tb-pending-src {
    color: var(--gold);
  }

  .tb-imm-src {
    color: #d8b4fe;
  }

  .tb-cap-form {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.625rem;
  }

  .tb-cap-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.75);
  }

  .tb-cap-input {
    width: 6rem;
    padding-right: 0.5rem;
  }

  .tb-cap-msg {
    font-size: 0.75rem;
  }

  @media (max-width: 640px) {
    .tb-head {
      padding: 1.125rem 1rem 1rem;
    }

    .tb-title {
      font-size: 1.375rem;
    }

    .tb-notice {
      padding: 0.75rem 1rem;
    }

    .tb-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .tb-stat {
      padding: 0.75rem 1rem;
    }

    .tb-stat + .tb-stat {
      border-left: 0;
    }

    .tb-stat:nth-child(even) {
      border-left: 1px solid rgba(255, 255, 255, 0.06);
    }

    .tb-stat:nth-child(n + 3) {
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .tb-stat-value {
      font-size: 1.25rem;
    }

    .tb-verdict {
      padding: 0.625rem 1rem;
    }

    .tb-warn {
      margin-left: 0;
    }

    .tb-row {
      grid-template-columns: 1.25rem minmax(0, 1fr) 4.5rem 1.25rem;
      gap: 0.5rem;
    }

    .tb-row::before {
      left: -0.875rem;
    }

    .tb-foot {
      flex-direction: column;
      align-items: stretch;
      padding: 0.875rem 1rem;
    }

    .tb-foot-note {
      max-width: none;
    }
  }
</style>
