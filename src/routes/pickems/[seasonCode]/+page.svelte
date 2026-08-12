<script lang="ts">
  import { untrack } from 'svelte'

  import { resolve } from '$app/paths'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import {
    buildPlayoffBracketSlots,
    normalizePlayoffPickemPayload,
    validatePlayoffPickemPayload,
    type PlayoffMatchId,
    type PlayoffPickemPayload,
    type PlayoffPickemTeam,
    type PlayoffPickemSlot,
  } from '$lib/playoffPickems'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  const RESULTS_VIEW_ID = '__results__'

  let picks = $state<Partial<Record<PlayoffMatchId, string>>>(
    untrack(() => ({ ...(data.mySubmission?.payload.picks ?? {}) }))
  )
  let selectedSubmissionId = $state<string>(untrack(() => RESULTS_VIEW_ID))
  let isSaving = $state(false)
  let saveMessage = $state<string | null>(null)
  let errorMessage = $state<string | null>(null)

  const teamById = $derived(
    new Map((data.teams as PlayoffPickemTeam[]).map((team) => [team.id, team]))
  )
  const isViewingResults = $derived(selectedSubmissionId === RESULTS_VIEW_ID)
  const selectedSubmission = $derived(
    data.submissions.find((submission) => submission.id === selectedSubmissionId) ?? null
  )
  const displayPayload = $derived<PlayoffPickemPayload>(
    isViewingResults
      ? { picks: { ...(data.actualWinners as Partial<Record<PlayoffMatchId, string>>) } }
      : selectedSubmission && selectedSubmission.id !== data.mySubmission?.id
        ? normalizePlayoffPickemPayload(selectedSubmission.payload)
        : { picks }
  )
  const slots = $derived(buildPlayoffBracketSlots(data.config, displayPayload))
  const isViewingOwn = $derived(
    !isViewingResults && (!selectedSubmission || selectedSubmission.id === data.mySubmission?.id)
  )

  const resolvedIds = $derived(new Set(data.config.resolved_matches?.map((r) => r.matchId) ?? []))
  const actualWinners = $derived(
    (data.actualWinners ?? {}) as Partial<Record<PlayoffMatchId, string>>
  )
  const decidedIds = $derived.by(() => {
    const ids = new Set(resolvedIds)
    for (const matchId of Object.keys(actualWinners) as PlayoffMatchId[]) {
      ids.add(matchId)
    }
    return ids
  })
  const slotById = $derived(new Map(slots.map((s) => [s.id, s])))

  function getSlots(ids: string[]): PlayoffPickemSlot[] {
    return ids.map((id) => slotById.get(id as PlayoffMatchId)!).filter(Boolean)
  }

  const ubQF = $derived(getSlots(['ub_qf_1', 'ub_qf_2', 'ub_qf_3', 'ub_qf_4']))
  const ubSF = $derived(getSlots(['ub_sf_1', 'ub_sf_2']))
  const ubFinal = $derived(getSlots(['ub_final']))
  const lbR1 = $derived(getSlots(['lb_r1_1', 'lb_r1_2']))
  const lbR2 = $derived(getSlots(['lb_r2_1', 'lb_r2_2']))
  const lbR3 = $derived(getSlots(['lb_r3']))
  const lbFinal = $derived(getSlots(['lb_final']))
  const grandFinal = $derived(getSlots(['grand_final']))

  const submissionOptions = $derived.by(() => {
    const opts: Array<{ value: string; label: string }> = []
    opts.push({ value: RESULTS_VIEW_ID, label: 'Actual Bracket' })
    if (data.mySubmission) {
      opts.push({ value: data.mySubmission.id, label: 'My bracket' })
    } else if (data.viewer.canEdit) {
      opts.push({ value: '', label: 'Current picks' })
    }
    for (const s of data.submissions) {
      if (s.id !== data.mySubmission?.id) {
        opts.push({ value: s.id, label: s.user.name })
      }
    }
    return opts
  })

  function teamLabel(teamId: string | null) {
    if (!teamId) return 'TBD'
    const team = teamById.get(teamId)
    if (!team) return 'Unknown team'
    return team.tag ?? team.name
  }

  function teamLogo(teamId: string | null) {
    return teamId ? (teamById.get(teamId)?.logo_url ?? null) : null
  }

  /** Playoff seed for a team, from the bracket config. */
  const seedByTeamId = $derived(
    new Map((data.config.seeds ?? []).map((entry) => [entry.teamId, entry.seed]))
  )

  function teamSeed(teamId: string | null): number | null {
    return teamId ? (seedByTeamId.get(teamId) ?? null) : null
  }

  function pickResult(matchId: PlayoffMatchId): 'correct' | 'wrong' | 'no-pick' | null {
    if (isViewingResults) return null
    if (resolvedIds.has(matchId)) return null
    const winner = actualWinners[matchId]
    if (!winner) return null
    const pick = displayPayload.picks[matchId]
    if (!pick) return 'no-pick'
    return pick === winner ? 'correct' : 'wrong'
  }

  function chooseWinner(matchId: PlayoffMatchId, teamId: string | null) {
    if (!data.viewer.canEdit || !isViewingOwn || !teamId || decidedIds.has(matchId)) return
    picks = { ...picks, [matchId]: teamId }
    saveMessage = null
    errorMessage = null
  }

  function clearBracket() {
    const kept: Partial<Record<PlayoffMatchId, string>> = {}
    for (const r of data.config.resolved_matches ?? []) {
      kept[r.matchId] = r.winnerId
    }
    picks = kept
    saveMessage = null
    errorMessage = null
  }

  async function saveBracket() {
    if (!data.viewer.canEdit || isSaving) return
    isSaving = true
    saveMessage = null
    errorMessage = null
    try {
      const payload = validatePlayoffPickemPayload(data.config, { picks })
      const response = await fetch(`/api/pickems/${data.season.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          typeof result.message === 'string' ? result.message : 'Failed to save bracket'
        )
      }
      saveMessage = 'Bracket saved.'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errorMessage = msg || 'Failed to save bracket'
    } finally {
      isSaving = false
    }
  }
</script>

<PageContainer class="pickem-page">
  <div class="flex min-h-[calc(100vh-4rem)] justify-center px-2 py-4">
    <div class="my-auto w-full">
      <!-- Header -->
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="text-xs font-bold tracking-wide uppercase" style="color: var(--hover);">
            {data.season.name}
          </p>
          <h1 class="responsive-title mt-1">Playoff Pick'em</h1>
          <p
            class="mt-1 flex flex-wrap items-center gap-3 text-sm"
            style="color: rgba(255,255,255,0.66);"
          >
            <span
              class="inline-block rounded-full px-2 py-0.5 text-xs font-bold uppercase"
              style="background: var(--accent); color: var(--text);"
            >
              {data.config.status}
            </span>
            {#if data.config.lock_at}
              <span>Locks {new Date(data.config.lock_at).toLocaleString()}</span>
            {/if}
          </p>
        </div>
        <div class="flex items-center gap-3">
          {#if data.submissions.length > 0}
            <div class="min-w-[180px]">
              <CustomSelect
                options={submissionOptions}
                value={selectedSubmissionId}
                compact={true}
                onSelect={(value) => (selectedSubmissionId = value)}
              />
            </div>
          {/if}
          {#if !data.viewer.isLoggedIn}
            <a
              class="inline-flex items-center rounded-md px-4 py-2 text-sm font-bold"
              style="background: var(--accent); color: var(--text);"
              href={resolve('/auth/login')}
            >
              Log in to submit
            </a>
          {:else if data.viewer.canEdit}
            <button
              type="button"
              class="rounded-md px-4 py-2 text-sm font-bold transition-colors"
              style="background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7);"
              onclick={clearBracket}
            >
              Clear
            </button>
            <button
              type="button"
              class="rounded-md px-4 py-2 text-sm font-bold transition-colors"
              style="background: var(--hover); color: var(--text);"
              onclick={saveBracket}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save bracket'}
            </button>
          {:else}
            <span class="text-sm" style="color: rgba(255,255,255,0.6);">Submissions locked</span>
          {/if}
        </div>
      </div>

      {#if saveMessage}
        <div
          class="mb-3 rounded-md px-3 py-2 text-sm font-semibold"
          style="background: rgba(74,222,128,0.15); color: #86efac;"
        >
          {saveMessage}
        </div>
      {/if}
      {#if errorMessage}
        <div
          class="mb-3 rounded-md px-3 py-2 text-sm font-semibold"
          style="background: rgba(244,63,94,0.15); color: #fda4af;"
        >
          {errorMessage}
        </div>
      {/if}

      <!-- Main area: bracket + leaderboard -->
      <div class="page-grid">
        <div class="bracket-wrapper">
          <!-- Upper bracket + Grand Final -->
          <div class="bracket-flow ub-flow">
            <div class="bracket-round conn-merge">
              {#each ubQF as slot (slot.id)}
                <div class="match-item">
                  {@render matchCard(slot)}
                </div>
              {/each}
            </div>
            <div class="bracket-round conn-merge">
              {#each ubSF as slot (slot.id)}
                <div class="match-item">
                  {@render matchCard(slot)}
                </div>
              {/each}
            </div>
            <div class="bracket-round conn-straight">
              {#each ubFinal as slot (slot.id)}
                <div class="match-item">
                  {@render matchCard(slot)}
                </div>
              {/each}
            </div>
            <div class="bracket-round">
              {#each grandFinal as slot (slot.id)}
                <div class="match-item">
                  {@render matchCard(slot)}
                </div>
              {/each}
            </div>
          </div>

          <!-- Lower bracket -->
          <div class="bracket-flow lb-flow">
            <div class="bracket-round conn-straight">
              {#each lbR1 as slot (slot.id)}
                <div class="match-item">
                  {@render matchCard(slot)}
                </div>
              {/each}
            </div>
            <div class="bracket-round conn-merge">
              {#each lbR2 as slot (slot.id)}
                <div class="match-item">
                  {@render matchCard(slot)}
                </div>
              {/each}
            </div>
            <div class="bracket-round conn-straight">
              {#each lbR3 as slot (slot.id)}
                <div class="match-item">
                  {@render matchCard(slot)}
                </div>
              {/each}
            </div>
            <div class="bracket-round">
              {#each lbFinal as slot (slot.id)}
                <div class="match-item">
                  {@render matchCard(slot)}
                </div>
              {/each}
            </div>
          </div>
        </div>

        <!-- Leaderboard sidebar -->
        <aside class="leaderboard">
          <div class="lb-heading">Leaderboard</div>
          <p class="text-xs" style="color: rgba(255,255,255,0.5);">
            {data.submissions.length} bracket{data.submissions.length !== 1 ? 's' : ''}
          </p>
          {#if data.leaderboard.length === 0}
            <div class="mt-2 text-sm" style="color: rgba(255,255,255,0.45);">
              No submissions yet.
            </div>
          {:else}
            <div class="lb-list">
              {#each data.leaderboard as entry (entry.id)}
                <button
                  type="button"
                  class="lb-row"
                  class:lb-active={selectedSubmissionId === entry.id}
                  onclick={() => (selectedSubmissionId = entry.id)}
                >
                  <span class="lb-rank">#{entry.rank}</span>
                  <span class="lb-name">{entry.user.name}</span>
                  <span class="lb-score">{entry.score}</span>
                </button>
              {/each}
            </div>
          {/if}
        </aside>
      </div>
    </div>
  </div>
</PageContainer>

{#snippet matchCard(slot: PlayoffPickemSlot)}
  {@const isResolved = resolvedIds.has(slot.id)}
  {@const isDecided = isResolved || Boolean(actualWinners[slot.id])}
  {@const result = pickResult(slot.id)}
  <article
    class="match-card"
    class:gf={slot.id === 'grand_final'}
    class:resolved={isDecided && result === null && !isViewingResults}
    class:pick-correct={result === 'correct'}
    class:pick-wrong={result === 'wrong'}
  >
    <div class="match-header">
      <span class="match-label">{slot.label}</span>
      {#if result === 'correct'}
        <span class="pick-indicator correct">Correct</span>
      {:else if result === 'wrong'}
        <span class="pick-indicator wrong">Wrong</span>
      {:else if isResolved}
        <span class="resolved-tag">Decided</span>
      {:else}
        <span class="pts">{slot.points}pt{slot.points !== 1 ? 's' : ''}</span>
      {/if}
    </div>
    {#each [slot.teamAId, slot.teamBId] as teamId, index (`${slot.id}-${index}`)}
      {@const isPick = !isViewingResults && slot.winnerId === teamId}
      {@const isWinner = isDecided && teamId === (actualWinners[slot.id] ?? null)}
      {@const seed = teamSeed(teamId)}
      <button
        type="button"
        class="team-btn"
        class:tbd={!teamId}
        class:pick-pending={isPick && result === null}
        class:pick-hit={isPick && result === 'correct'}
        class:pick-miss={isPick && result === 'wrong'}
        class:won={isWinner}
        disabled={isResolved || !data.viewer.canEdit || !isViewingOwn || !teamId}
        onclick={() => chooseWinner(slot.id, teamId)}
      >
        {#if seed != null}
          <span class="team-seed">{seed}</span>
        {/if}
        {#if teamLogo(teamId)}
          <img src={teamLogo(teamId) ?? ''} alt="" class="team-logo" />
        {/if}
        <span class="team-name">{teamLabel(teamId)}</span>
        <!-- Outcome markers: the pick carries right/wrong, the winner is
             stated separately so a correct-looking colour never lands on a
             team the viewer did not pick. -->
        {#if isPick && result === 'correct'}
          <span class="team-mark mark-hit" title="Your pick — correct">✓</span>
        {:else if isPick && result === 'wrong'}
          <span class="team-mark mark-miss" title="Your pick — wrong">✕</span>
        {:else if isPick}
          <span class="team-mark mark-pick" title="Your pick">●</span>
        {/if}
        {#if isWinner && !isPick}
          <span class="team-mark mark-won" title="Won this match">W</span>
        {/if}
      </button>
    {/each}
  </article>
{/snippet}

<style>
  h1,
  h2,
  p {
    margin: 0;
  }

  /* Page grid: bracket + leaderboard sidebar */
  .page-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.25rem;
  }

  @media (min-width: 1200px) {
    .page-grid {
      grid-template-columns: 1fr 250px;
    }
  }

  /* Bracket layout */
  .bracket-wrapper {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    --conn: rgba(255, 255, 255, 0.18);
    --conn-w: 1.25rem;
  }

  .bracket-flow {
    display: flex;
    gap: calc(var(--conn-w) * 2);
  }

  .bracket-round {
    flex: 1;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: visible;
    min-width: 0;
  }

  .match-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    position: relative;
    padding: 0.25rem 0;
  }

  /* Merge connector: odd match (top of pair) → "┐" */
  .conn-merge > .match-item:nth-of-type(odd)::after {
    content: '';
    position: absolute;
    right: calc(var(--conn-w) * -1);
    width: var(--conn-w);
    top: 50%;
    bottom: 0;
    border-top: 2px solid var(--conn);
    border-right: 2px solid var(--conn);
    pointer-events: none;
  }

  /* Merge connector: even match (bottom of pair) → "┘" */
  .conn-merge > .match-item:nth-of-type(even)::after {
    content: '';
    position: absolute;
    right: calc(var(--conn-w) * -1);
    width: var(--conn-w);
    top: 0;
    bottom: 50%;
    border-bottom: 2px solid var(--conn);
    border-right: 2px solid var(--conn);
    pointer-events: none;
  }

  /* Straight connector: horizontal line right */
  .conn-straight > .match-item::after {
    content: '';
    position: absolute;
    right: calc(var(--conn-w) * -1);
    width: var(--conn-w);
    top: 50%;
    border-top: 2px solid var(--conn);
    pointer-events: none;
  }

  /* Input connector: horizontal line from left */
  .bracket-round:not(:first-child) > .match-item::before {
    content: '';
    position: absolute;
    left: calc(var(--conn-w) * -1);
    width: var(--conn-w);
    top: 50%;
    border-top: 2px solid var(--conn);
    pointer-events: none;
  }

  /* Match cards */
  .match-card {
    min-width: 8rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.375rem;
    background: rgba(0, 0, 0, 0.2);
    padding: 0.4rem 0.5rem;
  }

  .match-card.gf {
    border-color: var(--accent);
    background: rgba(94, 52, 114, 0.1);
  }

  .match-card.resolved {
    opacity: 0.55;
  }

  .match-card.pick-correct {
    opacity: 1;
    border-color: rgba(74, 222, 128, 0.4);
    background: rgba(74, 222, 128, 0.06);
  }

  .match-card.pick-wrong {
    opacity: 1;
    border-color: rgba(244, 63, 94, 0.4);
    background: rgba(244, 63, 94, 0.06);
  }

  .resolved-tag {
    font-size: 0.5625rem;
    font-weight: 800;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
  }

  .pick-indicator {
    font-size: 0.5625rem;
    font-weight: 800;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .pick-indicator.correct {
    color: #86efac;
  }

  .pick-indicator.wrong {
    color: #fda4af;
  }

  /*
   * Colour means one thing only: how YOUR pick did.
   * Green = your pick was right, red = your pick was wrong, purple = pending.
   * The team that actually won is marked neutrally, because green on a team
   * you did not pick reads as "correct" and contradicts the Wrong label.
   */
  .team-btn.won {
    border-color: rgba(255, 255, 255, 0.28);
    background: rgba(255, 255, 255, 0.07);
  }

  .team-btn.pick-hit {
    border-color: rgba(74, 222, 128, 0.55);
    background: rgba(74, 222, 128, 0.16);
    box-shadow: 0 0 0 1px rgba(74, 222, 128, 0.35);
  }

  .team-btn.pick-miss {
    border-color: rgba(244, 63, 94, 0.5);
    background: rgba(244, 63, 94, 0.14);
    box-shadow: 0 0 0 1px rgba(244, 63, 94, 0.3);
  }

  /* Marker chips sit at the end of the row. */
  .team-mark {
    margin-left: auto;
    flex-shrink: 0;
    font-size: 0.5625rem;
    font-weight: 800;
    line-height: 1;
  }

  .mark-hit {
    color: #4ade80;
  }

  .mark-miss {
    color: #fb7185;
  }

  .mark-pick {
    color: #c084fc;
    font-size: 0.5rem;
  }

  .mark-won {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 0.875rem;
    padding: 0.0625rem 0.1875rem;
    border-radius: 0.1875rem;
    background: rgba(255, 255, 255, 0.14);
    color: rgba(255, 255, 255, 0.75);
  }

  /* Seed number, shown before the logo. */
  .team-seed {
    flex-shrink: 0;
    min-width: 0.875rem;
    font-size: 0.5625rem;
    font-weight: 700;
    text-align: center;
    color: rgba(255, 255, 255, 0.38);
    font-variant-numeric: tabular-nums;
  }

  .match-header {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.625rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.4);
    margin-bottom: 0.2rem;
  }

  .match-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pts {
    color: var(--hover);
    font-weight: 800;
    flex-shrink: 0;
  }

  .team-btn {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 0.25rem;
    background: rgba(255, 255, 255, 0.03);
    padding: 0.35rem 0.5rem;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background-color 0.15s;
  }

  .team-btn + .team-btn {
    margin-top: 0.2rem;
  }

  .team-btn:not(:disabled):hover {
    border-color: var(--hover);
    background: rgba(120, 67, 145, 0.18);
  }

  .team-btn.pick-pending {
    border-color: var(--hover);
    background: rgba(120, 67, 145, 0.3);
    box-shadow: 0 0 0 1px var(--hover);
  }

  .match-card.gf .team-btn:not(:disabled):hover {
    border-color: #c084fc;
    background: rgba(168, 85, 247, 0.25);
  }

  .match-card.gf .team-btn.pick-pending {
    border-color: #c084fc;
    background: rgba(168, 85, 247, 0.35);
    box-shadow: 0 0 0 1px #c084fc;
  }

  .team-btn.tbd {
    opacity: 0.35;
    cursor: default;
  }

  .team-btn:disabled:not(.tbd) {
    cursor: default;
  }

  .team-logo {
    width: 1.25rem;
    height: 1.25rem;
    flex: 0 0 auto;
    border-radius: 3px;
    object-fit: contain;
  }

  .team-name {
    font-size: 0.75rem;
    font-weight: 700;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Leaderboard sidebar */
  .leaderboard {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.375rem;
    background: rgba(0, 0, 0, 0.15);
    padding: 0.75rem;
  }

  @media (min-width: 1200px) {
    .leaderboard {
      position: sticky;
      top: 5rem;
    }
  }

  .lb-heading {
    font-size: 0.8125rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text);
    padding-bottom: 0.3rem;
    border-bottom: 1px solid var(--accent);
    margin-bottom: 0.3rem;
  }

  .lb-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.5rem;
    max-height: 60vh;
    overflow-y: auto;
  }

  .lb-row {
    display: grid;
    grid-template-columns: 2rem 1fr auto;
    align-items: center;
    gap: 0.4rem;
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 0.25rem;
    background: rgba(0, 0, 0, 0.1);
    padding: 0.4rem 0.5rem;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .lb-row:hover {
    border-color: var(--hover);
  }

  .lb-row.lb-active {
    border-color: var(--hover);
    background: rgba(120, 67, 145, 0.15);
  }

  .lb-rank {
    font-size: 0.75rem;
    font-weight: 800;
    color: rgba(255, 255, 255, 0.45);
  }

  .lb-name {
    font-size: 0.8125rem;
    font-weight: 700;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lb-score {
    font-size: 0.75rem;
    font-weight: 800;
    color: var(--hover);
  }

  /* Override PageContainer padding for wider bracket */
  :global(.page-container.pickem-page) {
    padding-left: 0.5rem;
    padding-right: 0.5rem;
  }

  @media (min-width: 768px) {
    :global(.page-container.pickem-page) {
      padding-left: 1rem;
      padding-right: 1rem;
    }
  }

  /* Responsive */
  @media (max-width: 900px) {
    .bracket-wrapper {
      overflow-x: auto;
    }

    .bracket-flow {
      min-width: 600px;
    }
  }
</style>
