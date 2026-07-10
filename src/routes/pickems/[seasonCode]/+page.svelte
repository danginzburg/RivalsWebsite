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

  let picks = $state<Partial<Record<PlayoffMatchId, string>>>(
    untrack(() => ({ ...(data.mySubmission?.payload.picks ?? {}) }))
  )
  let selectedSubmissionId = $state<string>(untrack(() => data.mySubmission?.id ?? ''))
  let isSaving = $state(false)
  let saveMessage = $state<string | null>(null)
  let errorMessage = $state<string | null>(null)

  const teamById = $derived(
    new Map((data.teams as PlayoffPickemTeam[]).map((team) => [team.id, team]))
  )
  const selectedSubmission = $derived(
    data.submissions.find((submission) => submission.id === selectedSubmissionId) ?? null
  )
  const displayPayload = $derived<PlayoffPickemPayload>(
    selectedSubmission && selectedSubmission.id !== data.mySubmission?.id
      ? normalizePlayoffPickemPayload(selectedSubmission.payload)
      : { picks }
  )
  const slots = $derived(buildPlayoffBracketSlots(data.config, displayPayload))
  const isViewingOwn = $derived(
    !selectedSubmission || selectedSubmission.id === data.mySubmission?.id
  )

  const resolvedIds = $derived(new Set(data.config.resolved_matches?.map((r) => r.matchId) ?? []))
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
    if (data.mySubmission) {
      opts.push({ value: data.mySubmission.id, label: 'My bracket' })
    } else {
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

  function chooseWinner(matchId: PlayoffMatchId, teamId: string | null) {
    if (!data.viewer.canEdit || !isViewingOwn || !teamId || resolvedIds.has(matchId)) return
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
        <div class="bracket-grid">
          <!-- Col 1: UB QF + LB R1 -->
          <div class="round-col">
            <div class="bracket-section">
              <div class="section-label ub">Upper Bracket</div>
              {#each ubQF as slot (slot.id)}
                {@render matchCard(slot)}
              {/each}
            </div>
            <div class="bracket-section">
              <div class="section-label lb">Lower Bracket</div>
              {#each lbR1 as slot (slot.id)}
                {@render matchCard(slot)}
              {/each}
            </div>
          </div>

          <!-- Col 2: UB SF + LB R2 -->
          <div class="round-col">
            <div class="bracket-section">
              <div class="section-label ub">Upper</div>
              {#each ubSF as slot (slot.id)}
                {@render matchCard(slot)}
              {/each}
            </div>
            <div class="bracket-section">
              <div class="section-label lb">Lower</div>
              {#each lbR2 as slot (slot.id)}
                {@render matchCard(slot)}
              {/each}
            </div>
          </div>

          <!-- Col 3: UB Final + LB R3 -->
          <div class="round-col">
            <div class="bracket-section">
              <div class="section-label ub">Upper</div>
              {#each ubFinal as slot (slot.id)}
                {@render matchCard(slot)}
              {/each}
            </div>
            <div class="bracket-section">
              <div class="section-label lb">Lower</div>
              {#each lbR3 as slot (slot.id)}
                {@render matchCard(slot)}
              {/each}
            </div>
          </div>

          <!-- Col 4: GF on top, LB Final below -->
          <div class="round-col">
            <div class="bracket-section gf-section">
              <div class="section-label gf">Grand Final</div>
              {#each grandFinal as slot (slot.id)}
                {@render matchCard(slot)}
              {/each}
            </div>
            <div class="bracket-section">
              <div class="section-label lb">Lower</div>
              {#each lbFinal as slot (slot.id)}
                {@render matchCard(slot)}
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
  <article class="match-card" class:gf={slot.id === 'grand_final'} class:resolved={isResolved}>
    <div class="match-header">
      <span class="match-label">{slot.label}</span>
      {#if isResolved}
        <span class="resolved-tag">Decided</span>
      {:else}
        <span class="pts">{slot.points}pt{slot.points !== 1 ? 's' : ''}</span>
      {/if}
    </div>
    {#each [slot.teamAId, slot.teamBId] as teamId, index (`${slot.id}-${index}`)}
      <button
        type="button"
        class="team-btn"
        class:picked={slot.winnerId === teamId}
        class:tbd={!teamId}
        disabled={isResolved || !data.viewer.canEdit || !isViewingOwn || !teamId}
        onclick={() => chooseWinner(slot.id, teamId)}
      >
        {#if teamLogo(teamId)}
          <img src={teamLogo(teamId) ?? ''} alt="" class="team-logo" />
        {/if}
        <span class="team-name">{teamLabel(teamId)}</span>
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

  /* Bracket: 4-column grid */
  .bracket-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.5rem;
    align-items: start;
  }

  .bracket-section {
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 0.375rem;
    padding: 0.3rem;
    background: rgba(0, 0, 0, 0.08);
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .gf-section {
    border-color: var(--accent);
    background: rgba(94, 52, 114, 0.08);
  }

  .section-label {
    font-size: 0.5rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding-bottom: 0.15rem;
    border-bottom: 1px solid;
  }

  .section-label.ub {
    color: rgba(147, 197, 253, 0.7);
    border-color: rgba(59, 130, 246, 0.25);
  }

  .section-label.lb {
    color: rgba(252, 165, 165, 0.7);
    border-color: rgba(239, 68, 68, 0.25);
  }

  .section-label.gf {
    color: rgba(216, 180, 254, 0.9);
    border-color: var(--accent);
  }

  /* Round columns */
  .round-col {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
  }

  /* Match cards */
  .match-card {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.375rem;
    background: rgba(0, 0, 0, 0.2);
    padding: 0.3rem 0.4rem;
  }

  .match-card.gf {
    border-color: var(--accent);
    background: rgba(94, 52, 114, 0.1);
  }

  .match-card.resolved {
    opacity: 0.55;
  }

  .resolved-tag {
    font-size: 0.5625rem;
    font-weight: 800;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
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
    padding: 0.25rem 0.4rem;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background-color 0.15s;
  }

  .team-btn + .team-btn {
    margin-top: 0.15rem;
  }

  .team-btn:not(:disabled):hover {
    border-color: var(--hover);
    background: rgba(120, 67, 145, 0.18);
  }

  .team-btn.picked {
    border-color: var(--hover);
    background: rgba(120, 67, 145, 0.3);
    box-shadow: 0 0 0 1px var(--hover);
  }

  .match-card.gf .team-btn:not(:disabled):hover {
    border-color: #c084fc;
    background: rgba(168, 85, 247, 0.25);
  }

  .match-card.gf .team-btn.picked {
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
    padding-left: 1rem;
    padding-right: 1rem;
  }

  @media (min-width: 768px) {
    :global(.page-container.pickem-page) {
      padding-left: 2rem;
      padding-right: 2rem;
    }
  }

  /* Responsive */
  @media (max-width: 900px) {
    .bracket-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 500px) {
    .bracket-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
