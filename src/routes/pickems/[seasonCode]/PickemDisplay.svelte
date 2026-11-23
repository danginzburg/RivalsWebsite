<script lang="ts">
  import { untrack, type Snippet } from 'svelte'

  import { resolve } from '$app/paths'
  import pickemMedal from '$lib/assets/accolades/pickem_medal.svg'
  import {
    buildPickemSlots,
    normalizePickemPayload,
    validatePickemPayload,
    type PickemPayload,
    type PickemTeam,
    type PickemSlot,
  } from '$lib/pickems'
  import type { PageData } from './$types'

  type Display = NonNullable<PageData['playoffs']>

  interface Props {
    display: Display
    season: PageData['season']
    /** Page title: the event's own when it is the season's only pick'em. */
    heading: string
    /** Season total across the bracket and weekly pick'ems. */
    seasonBoard: PageData['seasonBoard']
    me: PageData['me']
    /** Profile id of the season's pick'em champion, once every result is in. */
    seasonChampionId: string | null
    /** The Playoffs | Weekly switch, docked under the header when both exist. */
    tabs?: Snippet
  }

  let { display: data, season, heading, seasonBoard, me, seasonChampionId, tabs }: Props = $props()

  const isBracket = $derived(data.event.format === 'bracket')
  const entryNoun = $derived(isBracket ? 'bracket' : 'entry')
  const entryNounPlural = $derived(isBracket ? 'brackets' : 'entries')

  let picks = $state<Record<string, string>>(
    untrack(() => ({ ...(data.mySubmission?.payload.picks ?? {}) }))
  )
  let selectedSubmissionId = $state<string>(untrack(() => data.mySubmission?.id ?? ''))
  let isSaving = $state(false)
  let isDirty = $state(false)
  let saveMessage = $state<string | null>(null)
  let errorMessage = $state<string | null>(null)

  const teamById = $derived(new Map((data.teams as PickemTeam[]).map((team) => [team.id, team])))
  const selectedSubmission = $derived(
    data.submissions.find((submission) => submission.id === selectedSubmissionId) ?? null
  )
  const displayPayload = $derived<PickemPayload>(
    selectedSubmission && selectedSubmission.id !== data.mySubmission?.id
      ? normalizePickemPayload(selectedSubmission.payload)
      : { picks }
  )
  // A submission view propagates from that person's own picks; matchups
  // already carry their teams (assigned or filled from the linked game
  // server-side). The real bracket is drawn on the leaderboard page.
  const slots = $derived(buildPickemSlots(data.event, data.matches, displayPayload))

  const isViewingOwn = $derived(
    !selectedSubmission || selectedSubmission.id === data.mySubmission?.id
  )
  const viewedName = $derived(
    isViewingOwn
      ? null
      : (data.leaderboard.find((e) => e.id === selectedSubmissionId)?.user.name ?? null)
  )

  /*
   * The medal only means something once every match has a result — before
   * that the top of the leaderboard is just whoever is ahead so far. A tie at
   * the top has no single champion, so nothing is awarded: one rule, so the
   * banner and the row medal can never disagree.
   */
  const isScored = $derived(data.complete || data.event.status === 'scored')
  // The medal follows the season total (bracket + weekly), decided server-side.
  const champion = $derived(
    seasonChampionId
      ? (seasonBoard.find((entry) => entry.user.id === seasonChampionId) ?? null)
      : null
  )

  const resolvedIds = $derived(new Set(data.resolvedSlotKeys ?? []))
  const actualWinners = $derived((data.actualWinners ?? {}) as Record<string, string>)
  const decidedIds = $derived(new Set([...resolvedIds, ...Object.keys(actualWinners)]))
  const slotById = $derived(new Map(slots.map((s) => [s.id, s])))

  function getSlots(ids: string[]): PickemSlot[] {
    return ids.map((id) => slotById.get(id)!).filter(Boolean)
  }

  /** Bracket columns: the merge/straight connector each column draws to the next. */
  const upperColumns = $derived([
    {
      name: 'Quarterfinals',
      conn: 'conn-merge',
      slots: getSlots(['ub_qf_1', 'ub_qf_2', 'ub_qf_3', 'ub_qf_4']),
    },
    { name: 'Semifinals', conn: 'conn-merge', slots: getSlots(['ub_sf_1', 'ub_sf_2']) },
    { name: 'Upper Final', conn: 'conn-straight', slots: getSlots(['ub_final']) },
    { name: 'Grand Final', conn: '', slots: getSlots(['grand_final']) },
  ])
  const lowerColumns = $derived([
    { name: 'Round 1', conn: 'conn-straight', slots: getSlots(['lb_r1_1', 'lb_r1_2']) },
    { name: 'Round 2', conn: 'conn-merge', slots: getSlots(['lb_r2_1', 'lb_r2_2']) },
    { name: 'Round 3', conn: 'conn-straight', slots: getSlots(['lb_r3']) },
    { name: 'Lower Final', conn: '', slots: getSlots(['lb_final']) },
  ])

  function teamLabel(teamId: string | null) {
    if (!teamId) return 'TBD'
    const team = teamById.get(teamId)
    if (!team) return 'Unknown team'
    return team.tag ?? team.name
  }

  function teamName(teamId: string | null) {
    if (!teamId) return 'TBD'
    return teamById.get(teamId)?.name ?? 'Unknown team'
  }

  function teamLogo(teamId: string | null) {
    return teamId ? (teamById.get(teamId)?.logo_url ?? null) : null
  }

  /** Playoff seed for a team, from the bracket config. */
  const seedByTeamId = $derived(new Map(Object.entries(data.seeds ?? {})))

  function teamSeed(teamId: string | null): number | null {
    return teamId ? (seedByTeamId.get(teamId) ?? null) : null
  }

  function pickResult(matchId: string): 'correct' | 'wrong' | 'no-pick' | null {
    if (resolvedIds.has(matchId)) return null
    const winner = actualWinners[matchId]
    if (!winner) return null
    const pick = displayPayload.picks[matchId]
    if (!pick) return 'no-pick'
    return pick === winner ? 'correct' : 'wrong'
  }

  /**
   * The real winner, named only when it is not one of the two teams shown —
   * a propagated bracket can hold teams that never met, and then a wrong pick
   * alone does not say who did win.
   */
  function wonByLabel(slot: PickemSlot): string | null {
    if (resolvedIds.has(slot.id) || !slot.teamAId || !slot.teamBId) return null
    const winner = actualWinners[slot.id]
    if (!winner || winner === slot.teamAId || winner === slot.teamBId) return null
    return teamLabel(winner)
  }

  /** Score and progress for the entry on screen (yours or the one picked). */
  const summary = $derived.by(() => {
    let points = 0
    let correct = 0
    let decided = 0
    let openSeries = 0
    let openPoints = 0
    let picked = 0
    let pickable = 0
    for (const slot of slots) {
      if (resolvedIds.has(slot.id)) continue
      const winner = actualWinners[slot.id]
      if (winner) {
        decided += 1
        if (displayPayload.picks[slot.id] === winner) {
          correct += 1
          points += slot.points
        }
      } else {
        openSeries += 1
        openPoints += slot.points
        pickable += 1
        if (slot.winnerId) picked += 1
      }
    }
    return { points, correct, decided, openSeries, openPoints, picked, pickable }
  })

  const viewedEntry = $derived(data.leaderboard.find((e) => e.id === selectedSubmissionId) ?? null)
  const hasEntryOnScreen = $derived(Boolean(viewedEntry) || data.viewer.canEdit)

  /** The season-total row of whoever's entry is on screen (you, by default). */
  const viewedUserId = $derived(viewedEntry?.user.id ?? (isViewingOwn ? (me?.id ?? null) : null))
  const viewedSeason = $derived(
    viewedUserId ? (seasonBoard.find((e) => e.user.id === viewedUserId) ?? null) : null
  )

  // Season vs this pick'em only differ when the season runs both (tabs are shown then).
  const combined = $derived(Boolean(tabs))
  let chosenBoard = $state<'season' | 'event'>('season')
  const boardMode = $derived(combined ? chosenBoard : 'event')
  /** Leaderboard rows; each points at this pick'em's entry for that person, when they have one. */
  const boardRows = $derived.by(() => {
    if (boardMode === 'event') {
      return data.leaderboard.map((entry) => ({
        key: entry.id,
        rank: entry.rank,
        name: entry.user.name,
        score: entry.score,
        userId: entry.user.id,
        submissionId: entry.id as string | null,
        isMe: entry.id === data.mySubmission?.id,
      }))
    }
    return seasonBoard.map((entry) => {
      const submission = data.submissions.find((s) =>
        entry.user.id ? s.user.id === entry.user.id : s.user.name === entry.user.name
      )
      return {
        key: entry.id,
        rank: entry.rank,
        name: entry.user.name,
        score: entry.score,
        userId: entry.user.id,
        submissionId: submission?.id ?? null,
        isMe: Boolean(me && entry.user.id === me.id),
      }
    })
  })

  function formatLock(value: string) {
    return new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const metaLine = $derived.by(() => {
    const parts: string[] = []
    if (isScored) parts.push('Final')
    else if (data.event.lockAt) {
      parts.push(`${data.locked ? 'Locked' : 'Locks'} ${formatLock(data.event.lockAt)}`)
    } else if (data.locked) parts.push('Locked')
    const count = data.submissions.length
    parts.push(`${count} ${count === 1 ? entryNoun : entryNounPlural}`)
    const total = summary.decided + summary.openSeries
    if (total > 0)
      parts.push(`${summary.decided} of ${total} ${isBracket ? 'series' : 'matches'} decided`)
    return parts.join(' · ')
  })

  const statusText = $derived(
    data.preview
      ? 'Preview only'
      : isScored
        ? 'Final'
        : data.viewer.canEdit
          ? 'Picks open'
          : data.locked
            ? 'Picks locked'
            : 'Picks closed'
  )

  /** Matchup slots grouped by week, preserving row order. */
  const matchupGroups = $derived.by(() => {
    const groups: Array<{ key: string; label: string; slots: PickemSlot[] }> = []
    for (const slot of slots) {
      let group = groups.find((g) => g.key === slot.groupKey)
      if (!group) {
        group = { key: slot.groupKey, label: slot.groupKey || 'Matches', slots: [] }
        groups.push(group)
      }
      group.slots.push(slot)
    }
    return groups
  })

  /** Per-week progress for the week picker: right/decided once played, else picked/total. */
  function weekSummary(group: { slots: PickemSlot[] }) {
    let decided = 0
    let correct = 0
    let picked = 0
    for (const slot of group.slots) {
      const winner = actualWinners[slot.id]
      if (winner && !resolvedIds.has(slot.id)) {
        decided += 1
        if (displayPayload.picks[slot.id] === winner) correct += 1
      }
      if (slot.winnerId) picked += 1
    }
    if (decided > 0) return `${correct}/${decided} right`
    return `${picked}/${group.slots.length} picked`
  }

  // The week shown: the first one still to be played, else the last.
  let chosenWeek = $state<string | null>(null)
  const defaultWeek = $derived(
    (
      matchupGroups.find((g) => g.slots.some((s) => !decidedIds.has(s.id))) ??
      matchupGroups[matchupGroups.length - 1]
    )?.key ?? ''
  )
  const activeWeek = $derived(
    chosenWeek !== null && matchupGroups.some((g) => g.key === chosenWeek)
      ? chosenWeek
      : defaultWeek
  )
  const activeGroup = $derived(matchupGroups.find((g) => g.key === activeWeek) ?? null)

  function chooseWinner(matchId: string, teamId: string | null) {
    if (!data.viewer.canEdit || !isViewingOwn || !teamId || decidedIds.has(matchId)) return
    const next = { ...picks }
    // Tapping your current pick again clears it.
    if (next[matchId] === teamId) delete next[matchId]
    else next[matchId] = teamId
    picks = next
    isDirty = true
    saveMessage = null
    errorMessage = null
  }

  function clearBracket() {
    picks = {}
    isDirty = true
    saveMessage = null
    errorMessage = null
  }

  async function saveBracket() {
    if (!data.viewer.canEdit || isSaving) return
    isSaving = true
    saveMessage = null
    errorMessage = null
    try {
      const payload = validatePickemPayload(data.event, data.matches, { picks })
      const response = await fetch(`/api/pickems/${season.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, format: data.event.format }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          typeof result.message === 'string' ? result.message : 'Failed to save bracket'
        )
      }
      saveMessage = 'Saved'
      isDirty = false
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errorMessage = msg || 'Failed to save bracket'
    } finally {
      isSaving = false
    }
  }
</script>

<div class="page-content pickem-wrap">
  <div class="sheet">
    <!-- Header -->
    <header class="pk-head">
      <div class="min-w-0">
        <p class="pk-eyebrow">{season.name}</p>
        <h1 class="pk-title">{heading}</h1>
        <p class="pk-meta">{metaLine}</p>
        {#if data.preview}
          <p class="pk-meta">
            Draft preview: only admins can see this page until the pick'em is opened.
          </p>
        {/if}
      </div>
      <div class="pk-head-side">
        {#if !data.viewer.isLoggedIn && !data.preview && !data.locked}
          <a class="pk-btn pk-btn-primary" href={resolve('/auth/login')}>Log in to make picks</a>
        {:else}
          <span>{statusText}</span>
        {/if}
      </div>
    </header>

    {@render tabs?.()}

    <!-- Quiet score strip: the season total, then this pick'em's progress -->
    <div class="pk-strip">
      <div class="pk-cell">
        <div class="pk-label">{viewedName ? `${viewedName}'s season` : 'Season points'}</div>
        <div class="pk-value">
          {#if viewedSeason}{viewedSeason.score}<small>pts</small>{:else}—{/if}
        </div>
      </div>
      <div class="pk-cell">
        <div class="pk-label">Season rank</div>
        <div class="pk-value">
          {#if viewedSeason}{viewedSeason.rank}<small>of {seasonBoard.length}</small>{:else}—{/if}
        </div>
      </div>
      <div class="pk-cell">
        <div class="pk-label">{isBracket ? 'Playoff picks' : 'Weekly picks'}</div>
        <div class="pk-value">
          {#if hasEntryOnScreen}{summary.correct}<small
              >right of {summary.decided} · {summary.points} pts</small
            >{:else}—{/if}
        </div>
      </div>
      <div class="pk-cell">
        {#if data.viewer.canEdit && isViewingOwn}
          <div class="pk-label">Picked</div>
          <div class="pk-value">{summary.picked}<small>of {summary.pickable}</small></div>
        {:else}
          <div class="pk-label">Still to play</div>
          <div class="pk-value">
            {summary.openSeries}<small
              >{isBracket ? 'series' : 'matches'} · {summary.openPoints} pts</small
            >
          </div>
        {/if}
      </div>
    </div>

    <div class="pk-body">
      <div class="pk-main">
        {#if !isViewingOwn && viewedName}
          <div class="pk-viewing">
            <span>Viewing {viewedName}'s {entryNoun}</span>
            {#if data.mySubmission || data.viewer.canEdit}
              <button
                type="button"
                class="pk-link"
                onclick={() => (selectedSubmissionId = data.mySubmission?.id ?? '')}
              >
                Back to mine
              </button>
            {/if}
          </div>
        {/if}

        {#if isBracket}
          <div class="sheet-head">
            <span class="sheet-title">Upper bracket</span>
            <span class="sheet-note">Points grow each round · Grand Final is worth the most</span>
          </div>
          <div class="bk-scroll">
            <div class="bk-flow bk-upper">
              {#each upperColumns as column (column.name)}
                <div class="bk-col">
                  <div class="bk-col-name">{column.name}</div>
                  <div class="bk-col-body {column.conn}">
                    {#each column.slots as slot (slot.id)}
                      <div class="bk-item">{@render matchCard(slot)}</div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>

          <div class="sheet-head">
            <span class="sheet-title">Lower bracket</span>
          </div>
          <div class="bk-scroll">
            <div class="bk-flow bk-lower">
              {#each lowerColumns as column (column.name)}
                <div class="bk-col">
                  <div class="bk-col-name">{column.name}</div>
                  <div class="bk-col-body {column.conn}">
                    {#each column.slots as slot (slot.id)}
                      <div class="bk-item">{@render matchCard(slot)}</div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {:else}
          {#if matchupGroups.length > 1}
            <div class="wk-picker" role="tablist" aria-label="Weeks">
              {#each matchupGroups as group (group.key)}
                <button
                  type="button"
                  role="tab"
                  class="wk-chip"
                  class:wk-on={group.key === activeWeek}
                  aria-selected={group.key === activeWeek}
                  onclick={() => (chosenWeek = group.key)}
                >
                  <b>{group.label}</b>
                  <span>{weekSummary(group)}</span>
                </button>
              {/each}
            </div>
          {/if}

          {#if activeGroup}
            <div class="sheet-head">
              <span class="sheet-title">{activeGroup.label}</span>
              <span class="sheet-note">
                {#if data.viewer.canEdit && isViewingOwn}
                  Tap a team to pick it, tap again to clear
                {:else}
                  {activeGroup.slots.length}
                  {activeGroup.slots.length === 1 ? 'match' : 'matches'}
                {/if}
              </span>
            </div>
            <div class="mu-list">
              {#each activeGroup.slots as slot (slot.id)}
                {@render matchupRow(slot)}
              {/each}
            </div>
          {/if}
        {/if}

        {#if data.viewer.canEdit}
          <div class="pk-bar">
            <div class="pk-bar-text">
              {summary.picked} of {summary.pickable} picked
              {#if errorMessage}
                <span class="pk-bar-error">{errorMessage}</span>
              {:else if saveMessage}
                <span class="pk-bar-ok">{saveMessage}</span>
              {:else if isDirty}
                <small>Unsaved changes</small>
              {/if}
            </div>
            <button type="button" class="pk-btn" onclick={clearBracket}>Clear</button>
            <button
              type="button"
              class="pk-btn pk-btn-primary"
              onclick={saveBracket}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : isBracket ? 'Save bracket' : 'Save picks'}
            </button>
          </div>
        {:else if isBracket}
          <div class="pk-legend">
            <span><b class="mk-pick">●</b>Pick, not played yet</span>
            <span><b class="mk-hit">✓</b>Pick won</span>
            <span><b class="mk-miss">✕</b>Pick lost</span>
            <span>Small number = seed</span>
          </div>
        {/if}
      </div>

      <!-- Leaderboard: a section of the same sheet -->
      <aside class="pk-aside" aria-label="Leaderboard">
        <div class="sheet-head">
          <span class="sheet-title">Leaderboard</span>
          {#if combined}
            <div class="lb-seg" role="group" aria-label="Leaderboard range">
              <button
                type="button"
                class:lb-seg-on={boardMode === 'season'}
                aria-pressed={boardMode === 'season'}
                onclick={() => (chosenBoard = 'season')}
              >
                Season
              </button>
              <button
                type="button"
                class:lb-seg-on={boardMode === 'event'}
                aria-pressed={boardMode === 'event'}
                onclick={() => (chosenBoard = 'event')}
              >
                {isBracket ? 'Playoffs' : 'Weekly'}
              </button>
            </div>
          {/if}
        </div>
        <p class="lb-note">
          {#if boardMode === 'season'}
            Playoffs + weekly · {seasonBoard.length}
            {seasonBoard.length === 1 ? 'player' : 'players'}
          {:else}
            {data.submissions.length}
            {data.submissions.length === 1 ? entryNoun : entryNounPlural}
          {/if}
          {#if boardRows.length > 0}· pick a row to view their {entryNoun}{/if}
        </p>
        {#if champion}
          <div class="lb-champ">
            <img src={pickemMedal} alt="" class="lb-champ-medal" />
            <span class="lb-champ-label">Pick'em Champion</span>
            <span class="lb-champ-name">{champion.user.name}</span>
          </div>
        {/if}
        {#if boardRows.length === 0}
          <p class="lb-empty">No {entryNounPlural} yet.</p>
        {:else}
          <div class="lb-list">
            {#each boardRows as row (row.key)}
              <button
                type="button"
                class="lb-row"
                class:lb-me={row.isMe}
                class:lb-active={row.submissionId !== null &&
                  selectedSubmissionId === row.submissionId &&
                  !row.isMe}
                aria-pressed={row.submissionId !== null &&
                  selectedSubmissionId === row.submissionId}
                disabled={row.submissionId === null}
                title={row.submissionId === null ? `No ${entryNoun} for this pick'em` : undefined}
                onclick={() => {
                  if (row.submissionId) selectedSubmissionId = row.submissionId
                }}
              >
                {#if champion && row.userId && champion.user.id === row.userId}
                  <img src={pickemMedal} alt="Pick'em Champion" class="lb-medal" />
                {:else}
                  <span class="lb-rank">{row.rank}</span>
                {/if}
                <span class="lb-name">{row.name}{row.isMe ? ' (you)' : ''}</span>
                <span class="lb-score">{row.score}</span>
              </button>
            {/each}
          </div>
        {/if}
      </aside>
    </div>
  </div>
</div>

{#snippet matchCard(slot: PickemSlot)}
  {@const isResolved = resolvedIds.has(slot.id)}
  {@const isDecided = isResolved || Boolean(actualWinners[slot.id])}
  {@const result = pickResult(slot.id)}
  {@const wonBy = wonByLabel(slot)}
  <article class="bk-match" class:bk-done={isDecided && result === null}>
    <div class="bk-match-head">
      <span class="bk-match-label">{slot.label}</span>
      <span>{isResolved ? 'Decided' : `${slot.points} pt${slot.points !== 1 ? 's' : ''}`}</span>
    </div>
    {#each [slot.teamAId, slot.teamBId] as teamId, index (`${slot.id}-${index}`)}
      {@const isPick = slot.winnerId === teamId && Boolean(teamId)}
      {@const isWinner = isDecided && teamId === (actualWinners[slot.id] ?? null)}
      {@const seed = teamSeed(teamId)}
      <button
        type="button"
        class="bk-team"
        class:bk-tbd={!teamId}
        class:is-pick={isPick && result === null}
        class:is-hit={isPick && result === 'correct'}
        class:is-miss={isPick && result === 'wrong'}
        disabled={isDecided || !data.viewer.canEdit || !isViewingOwn || !teamId}
        onclick={() => chooseWinner(slot.id, teamId)}
      >
        <span class="bk-seed">{seed ?? ''}</span>
        {#if teamLogo(teamId)}
          <img src={teamLogo(teamId) ?? ''} alt="" class="bk-logo" />
        {:else}
          <span class="bk-logo"></span>
        {/if}
        <span class="bk-name">{teamLabel(teamId)}</span>
        <!-- The pick carries right/wrong. The winner is only marked when no
             pick implies it, so a result mark never lands on a team the
             viewer did not pick. -->
        {#if isPick && result === 'correct'}
          <span class="bk-mark mk-hit" title="Pick won">✓</span>
        {:else if isPick && result === 'wrong'}
          <span class="bk-mark mk-miss" title="Pick lost">✕</span>
        {:else if isPick}
          <span class="bk-mark mk-pick" title="Pick">●</span>
        {:else if isWinner && result !== 'wrong'}
          <span class="bk-mark bk-won" title="Won this match">W</span>
        {/if}
      </button>
    {/each}
    {#if wonBy}
      <div class="bk-wonby">Won by {wonBy}</div>
    {/if}
  </article>
{/snippet}

{#snippet matchupRow(slot: PickemSlot)}
  {@const isResolved = resolvedIds.has(slot.id)}
  {@const winner = actualWinners[slot.id] ?? null}
  {@const isDecided = isResolved || Boolean(winner)}
  {@const result = pickResult(slot.id)}
  <div class="mu-row">
    <div class="mu-label">{slot.label}</div>
    {#each [slot.teamAId, slot.teamBId] as teamId, index (`${slot.id}-${index}`)}
      {@const isPick = slot.winnerId === teamId && Boolean(teamId)}
      <button
        type="button"
        class="mu-half"
        class:mu-a={index === 0}
        class:mu-b={index === 1}
        class:bk-tbd={!teamId}
        class:mu-decided={isDecided}
        class:mu-win={isDecided && teamId === winner}
        class:mu-lose={isDecided && winner && teamId !== winner}
        class:is-pick={isPick && result === null}
        class:is-hit={isPick && result === 'correct'}
        class:is-miss={isPick && result === 'wrong'}
        aria-pressed={isPick}
        disabled={isDecided || !data.viewer.canEdit || !isViewingOwn || !teamId}
        onclick={() => chooseWinner(slot.id, teamId)}
      >
        {#if isPick && result === 'correct'}
          <span class="bk-mark mk-hit" title="Pick won">✓</span>
        {:else if isPick && result === 'wrong'}
          <span class="bk-mark mk-miss" title="Pick lost">✕</span>
        {:else if isPick}
          <span class="bk-mark mk-pick" title="Pick">●</span>
        {/if}
        {#if teamLogo(teamId)}
          <img src={teamLogo(teamId) ?? ''} alt="" class="mu-logo" />
        {/if}
        <span class="mu-name">{teamName(teamId)}</span>
        <span class="mu-tag">{teamLabel(teamId)}</span>
      </button>
      {#if index === 0}
        <div class="mu-mid">
          {#if isResolved}
            Decided
          {:else if result === 'no-pick'}
            <b>Final</b>No pick
          {:else if winner}
            <b>Final</b>
          {:else}
            <b>vs</b>{slot.points} pt{slot.points !== 1 ? 's' : ''}
          {/if}
        </div>
      {/if}
    {/each}
  </div>
{/snippet}

<style src="./PickemDisplay.css"></style>
