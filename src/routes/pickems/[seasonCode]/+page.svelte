<script lang="ts">
  import { untrack } from 'svelte'

  import { resolve } from '$app/paths'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import {
    buildPlayoffBracketSlots,
    normalizePlayoffPickemPayload,
    validatePlayoffPickemPayload,
    type PlayoffMatchId,
    type PlayoffPickemPayload,
    type PlayoffPickemTeam,
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
  const upperSlots = $derived(slots.filter((slot) => slot.bracket === 'upper'))
  const lowerSlots = $derived(slots.filter((slot) => slot.bracket === 'lower'))
  const finalSlots = $derived(slots.filter((slot) => slot.bracket === 'final'))
  const isViewingOwn = $derived(
    !selectedSubmission || selectedSubmission.id === data.mySubmission?.id
  )

  function teamLabel(teamId: string | null) {
    if (!teamId) return 'TBD'
    const team = teamById.get(teamId)
    if (!team) return 'Unknown team'
    return team.tag ? `${team.name} (${team.tag})` : team.name
  }

  function teamLogo(teamId: string | null) {
    return teamId ? (teamById.get(teamId)?.logo_url ?? null) : null
  }

  function chooseWinner(matchId: PlayoffMatchId, teamId: string | null) {
    if (!data.viewer.canEdit || !isViewingOwn || !teamId) return
    picks = { ...picks, [matchId]: teamId }
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
      errorMessage = err instanceof Error ? err.message : 'Failed to save bracket'
    } finally {
      isSaving = false
    }
  }

  function roundTitle(slotIds: PlayoffMatchId[]) {
    const first = slotIds[0]
    if (!first) return ''
    if (first.startsWith('ub_qf')) return 'Upper Round 1'
    if (first.startsWith('ub_sf')) return 'Upper Round 2'
    if (first === 'ub_final') return 'Upper Final'
    if (first.startsWith('lb_r1')) return 'Lower Round 1'
    if (first.startsWith('lb_r2')) return 'Lower Round 2'
    if (first === 'lb_r3') return 'Lower Round 3'
    if (first === 'lb_final') return 'Lower Final'
    return 'Grand Final'
  }
</script>

<PageContainer>
  <section class="pickem-header">
    <div>
      <p class="eyebrow">{data.season.name}</p>
      <h1>Playoff Pick'em</h1>
      <p class="status-line">
        {data.config.status.toUpperCase()}
        {#if data.config.lock_at}
          <span>Locks {new Date(data.config.lock_at).toLocaleString()}</span>
        {/if}
      </p>
    </div>
    <div class="actions">
      {#if !data.viewer.isLoggedIn}
        <a class="login-link" href={resolve('/auth/login')}>Log in to submit</a>
      {:else if data.viewer.canEdit}
        <button type="button" onclick={saveBracket} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save bracket'}
        </button>
      {:else}
        <span class="locked-label">Submissions locked</span>
      {/if}
    </div>
  </section>

  {#if saveMessage}
    <div class="notice success">{saveMessage}</div>
  {/if}
  {#if errorMessage}
    <div class="notice error">{errorMessage}</div>
  {/if}

  {#if data.submissions.length > 0}
    <section class="viewer-bar">
      <label for="submission-view">Viewing bracket</label>
      <select id="submission-view" bind:value={selectedSubmissionId}>
        {#if data.mySubmission}
          <option value={data.mySubmission.id}>My bracket</option>
        {:else}
          <option value="">Current picks</option>
        {/if}
        {#each data.submissions as submission (submission.id)}
          {#if submission.id !== data.mySubmission?.id}
            <option value={submission.id}>{submission.user.name}</option>
          {/if}
        {/each}
      </select>
    </section>
  {/if}

  <section class="bracket-grid">
    <div class="bracket-section">
      <h2>Upper Bracket</h2>
      {#each [1, 2, 3, 4] as round (round)}
        {@const roundSlots = upperSlots.filter((slot) => slot.round === round)}
        <div class="round">
          <h3>{roundTitle(roundSlots.map((slot) => slot.id))}</h3>
          {#each roundSlots as slot (slot.id)}
            <article class="match-card">
              <div class="match-meta">
                <span>{slot.label}</span>
                <strong>{slot.points} pts</strong>
              </div>
              {#each [slot.teamAId, slot.teamBId] as teamId, index (`${slot.id}-${index}`)}
                <button
                  type="button"
                  class:active={slot.winnerId === teamId}
                  disabled={!data.viewer.canEdit || !isViewingOwn || !teamId}
                  onclick={() => chooseWinner(slot.id, teamId)}
                >
                  {#if teamLogo(teamId)}
                    <img src={teamLogo(teamId) ?? ''} alt="" />
                  {/if}
                  <span>{teamLabel(teamId)}</span>
                </button>
              {/each}
            </article>
          {/each}
        </div>
      {/each}
    </div>

    <div class="bracket-section">
      <h2>Lower Bracket</h2>
      {#each [1, 2, 3] as round (round)}
        {@const roundSlots = lowerSlots.filter((slot) => slot.round === round)}
        <div class="round">
          <h3>{roundTitle(roundSlots.map((slot) => slot.id))}</h3>
          {#each roundSlots as slot (slot.id)}
            <article class="match-card">
              <div class="match-meta">
                <span>{slot.label}</span>
                <strong>{slot.points} pts</strong>
              </div>
              {#each [slot.teamAId, slot.teamBId] as teamId, index (`${slot.id}-${index}`)}
                <button
                  type="button"
                  class:active={slot.winnerId === teamId}
                  disabled={!data.viewer.canEdit || !isViewingOwn || !teamId}
                  onclick={() => chooseWinner(slot.id, teamId)}
                >
                  {#if teamLogo(teamId)}
                    <img src={teamLogo(teamId) ?? ''} alt="" />
                  {/if}
                  <span>{teamLabel(teamId)}</span>
                </button>
              {/each}
            </article>
          {/each}
        </div>
      {/each}
    </div>

    <div class="bracket-section final-section">
      <h2>Final</h2>
      {#each finalSlots as slot (slot.id)}
        <article class="match-card">
          <div class="match-meta">
            <span>{slot.label}</span>
            <strong>{slot.points} pts</strong>
          </div>
          {#each [slot.teamAId, slot.teamBId] as teamId, index (`${slot.id}-${index}`)}
            <button
              type="button"
              class:active={slot.winnerId === teamId}
              disabled={!data.viewer.canEdit || !isViewingOwn || !teamId}
              onclick={() => chooseWinner(slot.id, teamId)}
            >
              {#if teamLogo(teamId)}
                <img src={teamLogo(teamId) ?? ''} alt="" />
              {/if}
              <span>{teamLabel(teamId)}</span>
            </button>
          {/each}
        </article>
      {/each}
    </div>
  </section>

  <section class="leaderboard">
    <div>
      <h2>Leaderboard</h2>
      <p>{data.submissions.length} submitted brackets</p>
    </div>
    {#if data.leaderboard.length === 0}
      <div class="empty">No submissions yet.</div>
    {:else}
      <div class="leaderboard-list">
        {#each data.leaderboard as entry (entry.id)}
          <button type="button" onclick={() => (selectedSubmissionId = entry.id)}>
            <span>#{entry.rank}</span>
            <strong>{entry.user.name}</strong>
            <em>{entry.score} pts</em>
          </button>
        {/each}
      </div>
    {/if}
  </section>
</PageContainer>

<style>
  .pickem-header,
  .viewer-bar,
  .leaderboard {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    background: rgba(5, 8, 14, 0.72);
  }

  .pickem-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.25rem;
  }

  .eyebrow {
    color: #93c5fd;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  h1,
  h2,
  h3,
  p {
    margin: 0;
  }

  h1 {
    margin-top: 0.25rem;
    color: var(--text);
    font-size: clamp(2rem, 6vw, 3.75rem);
    line-height: 1;
  }

  .status-line {
    margin-top: 0.5rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    color: rgba(255, 255, 255, 0.72);
    font-size: 0.875rem;
  }

  .actions button,
  .login-link {
    display: inline-flex;
    min-height: 2.5rem;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: #dc2626;
    padding: 0.65rem 1rem;
    color: #fff;
    font-weight: 800;
    text-decoration: none;
  }

  .actions button:disabled {
    opacity: 0.65;
  }

  .locked-label {
    color: rgba(255, 255, 255, 0.72);
    font-size: 0.875rem;
  }

  .notice {
    margin-top: 1rem;
    border-radius: 6px;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    font-weight: 700;
  }

  .success {
    background: rgba(34, 197, 94, 0.16);
    color: #86efac;
  }

  .error {
    background: rgba(239, 68, 68, 0.16);
    color: #fca5a5;
  }

  .viewer-bar {
    margin-top: 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
  }

  .viewer-bar label {
    color: rgba(255, 255, 255, 0.72);
    font-size: 0.875rem;
    font-weight: 700;
  }

  .viewer-bar select {
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(0, 0, 0, 0.35);
    color: var(--text);
    padding: 0.5rem 0.75rem;
  }

  .bracket-grid {
    margin-top: 1rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
  }

  .bracket-section {
    display: grid;
    gap: 0.75rem;
  }

  .bracket-section h2 {
    color: var(--text);
    font-size: 1.15rem;
  }

  .round {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.75rem;
  }

  .round h3 {
    grid-column: 1 / -1;
    color: rgba(255, 255, 255, 0.72);
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .match-card {
    min-width: 0;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    background: rgba(10, 15, 24, 0.84);
    padding: 0.75rem;
  }

  .match-meta {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    color: rgba(255, 255, 255, 0.62);
    font-size: 0.75rem;
    font-weight: 800;
  }

  .match-card button {
    margin-top: 0.5rem;
    display: flex;
    min-height: 3rem;
    width: 100%;
    align-items: center;
    gap: 0.65rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.05);
    padding: 0.55rem 0.65rem;
    color: var(--text);
    text-align: left;
  }

  .match-card button.active {
    border-color: rgba(34, 197, 94, 0.7);
    background: rgba(34, 197, 94, 0.16);
  }

  .match-card button:disabled {
    cursor: default;
    opacity: 0.82;
  }

  .match-card img {
    width: 1.85rem;
    height: 1.85rem;
    flex: 0 0 auto;
    border-radius: 4px;
    object-fit: contain;
  }

  .match-card span {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 0.875rem;
    font-weight: 750;
  }

  .leaderboard {
    margin-top: 1rem;
    padding: 1rem;
  }

  .leaderboard h2 {
    color: var(--text);
    font-size: 1.15rem;
  }

  .leaderboard p,
  .empty {
    color: rgba(255, 255, 255, 0.66);
    font-size: 0.875rem;
  }

  .leaderboard-list {
    margin-top: 0.75rem;
    display: grid;
    gap: 0.5rem;
  }

  .leaderboard-list button {
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.05);
    padding: 0.65rem 0.75rem;
    color: var(--text);
    text-align: left;
  }

  .leaderboard-list span,
  .leaderboard-list em {
    color: rgba(255, 255, 255, 0.66);
    font-style: normal;
    font-weight: 800;
  }

  @media (min-width: 1100px) {
    .bracket-grid {
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(240px, 0.55fr);
      align-items: start;
    }

    .final-section {
      position: sticky;
      top: 1rem;
    }
  }

  @media (max-width: 720px) {
    .pickem-header,
    .viewer-bar {
      align-items: stretch;
      flex-direction: column;
    }

    h1 {
      font-size: 2.25rem;
    }
  }
</style>
