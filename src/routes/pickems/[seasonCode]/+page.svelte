<script lang="ts">
  import { invalidateAll } from '$app/navigation'

  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { ChevronDown } from 'lucide-svelte'
  import {
    PICKEM_BUCKETS,
    coerceMatchupBucketAssignments,
    getAllowedPickemBucketsForRecord,
    getMatchupJointOutcomes,
    matchupAllowedBucketsForSide,
    partnerBucketAfterPick,
    type PickemBucket,
  } from '$lib/pickemBuckets'
  import PickemTeamBucketRow from '$lib/components/pickems/PickemTeamBucketRow.svelte'
  import PickemReceipt from '$lib/components/pickems/PickemReceipt.svelte'
  import {
    buildPickemMatchupPairsFromRows,
    buildPickemMatchupSideMetaFromRows,
  } from '$lib/pickemFinalRoundMatchups'
  import type { PickemTeamRow, PickemWrongPick } from '$lib/server/pickems'

  type StandingBlock =
    | { kind: 'pair'; pairIndex: number; first: PickemTeamRow; second: PickemTeamRow }
    | { kind: 'single'; row: PickemTeamRow }

  const bucketOptions = PICKEM_BUCKETS
  const bucketLabels: Record<PickemBucket, string> = {
    '3-0': '3-0',
    '2-1': '2-1',
    '1-2': '1-2',
    '0-3': '0-3',
  }
  const expectedCounts: Record<PickemBucket, number> = {
    '3-0': 3,
    '2-1': 9,
    '1-2': 9,
    '0-3': 3,
  }

  let { data }: PageProps = $props()

  const baselineRows = $derived(data.baselineRows ?? [])
  const submissionsList = $derived(data.submissionsList ?? [])
  const pickemLeaderboard = $derived(data.pickemLeaderboard ?? [])
  const hasScoredLeaderboard = $derived(Boolean(data.hasScoredLeaderboard))
  const viewer = $derived(data.viewer ?? null)
  const pickemMaxPoints = $derived(Number(data.config.participant_count ?? 24))

  /** After scoring: per-team whether the viewer's submitted bucket matched the final result (for receipt tags). */
  const receiptPickAccuracyByTeamId = $derived.by((): Record<string, boolean> | null => {
    if (!hasScoredLeaderboard || !viewer) return null
    const entry = pickemLeaderboard.find((r) => r.user.id === viewer.profileId)
    if (!entry) return null
    const wrong = new Set(entry.wrongPicks.map((w) => w.teamId))
    const out: Record<string, boolean> = {}
    for (const row of baselineRows) {
      const id = row.team?.id
      if (!id) continue
      out[id] = !wrong.has(id)
    }
    return Object.keys(out).length > 0 ? out : null
  })
  const submissionMeta = $derived(data.submissionMeta ?? null)
  const isLocked = $derived(Boolean(data.isLocked))
  /** One submission per user; after submit, picks are read-only even before season lock. */
  const isSubmitted = $derived(Boolean(submissionMeta))
  const bucketsDisabled = $derived(isLocked || isSubmitted)

  let saveMessage = $state<string | null>(null)
  let saveError = $state<string | null>(null)
  let isSaving = $state(false)

  let pickemLbExpanded = $state<Record<string, boolean>>({})

  function pickemLbToggle(rowId: string) {
    pickemLbExpanded = { ...pickemLbExpanded, [rowId]: !pickemLbExpanded[rowId] }
  }

  function wrongPickTeamLabel(w: PickemWrongPick) {
    const tag = w.tag?.trim()
    if (tag) return `[${tag.toUpperCase()}] ${w.name}`
    return w.name
  }

  function pickemBucketWins(bucket: PickemWrongPick['predicted']): number {
    const w = Number(bucket.split('-')[0])
    return Number.isFinite(w) ? w : 0
  }

  /** W = predicted a higher win bucket than they got (too optimistic). L = predicted lower (too pessimistic). */
  function wrongPickOutcomeLetter(w: PickemWrongPick): 'W' | 'L' {
    return pickemBucketWins(w.predicted) > pickemBucketWins(w.actual) ? 'W' : 'L'
  }

  function wrongPickOutcomeAria(w: PickemWrongPick): string {
    return wrongPickOutcomeLetter(w) === 'W'
      ? `Predicted too high (${w.predicted} vs ${w.actual})`
      : `Predicted too low (${w.predicted} vs ${w.actual})`
  }

  function pickDefaultBucket(allowed: PickemBucket[]): PickemBucket {
    if (allowed.includes('2-1')) return '2-1'
    return allowed[0] ?? '2-1'
  }

  /** Tag when set; otherwise truncate long display names for dense pickem UI */
  function pickemTeamShortLabel(team: PickemTeamRow['team'], maxChars = 14) {
    if (!team) return 'Team'
    const tag = team.tag?.trim()
    if (tag) return tag.toUpperCase()
    const name = team.name?.trim() ?? 'Team'
    if (name.length <= maxChars) return name
    return `${name.slice(0, Math.max(1, maxChars - 1))}…`
  }

  function pickemTeamFullLabel(team: PickemTeamRow['team']) {
    return team?.name?.trim() || 'Team'
  }

  function initialAssignments() {
    const assigned = new Map<string, string>()
    const baselineR = Number(data.config.baseline_completed_rounds ?? 2)
    const totalR = Number(data.config.prediction_round ?? 3)
    const rows = data.baselineRows ?? []

    const payloadSource = (data.submission ?? {}) as {
      buckets?: Record<string, string[]>
      payload?: { buckets?: Record<string, string[]> }
    }
    const payload = payloadSource.buckets ?? payloadSource.payload?.buckets ?? {}

    for (const bucket of bucketOptions) {
      const teamIds = Array.isArray(payload[bucket]) ? payload[bucket] : []
      for (const teamId of teamIds) assigned.set(teamId, bucket)
    }

    if (assigned.size > 0) {
      for (const row of rows) {
        const id = row.team?.id
        if (!id) continue
        const cur = assigned.get(id)
        if (!cur) continue
        const allowed = getAllowedPickemBucketsForRecord(row.wins, row.losses, baselineR, totalR)
        if (!allowed.includes(cur as PickemBucket)) assigned.set(id, pickDefaultBucket(allowed))
      }
      return coerceMatchupBucketAssignments(assigned, rows, baselineR, totalR)
    }

    for (const row of rows) {
      if (row.team?.id) {
        const allowed = getAllowedPickemBucketsForRecord(row.wins, row.losses, baselineR, totalR)
        assigned.set(row.team.id, pickDefaultBucket(allowed))
      }
    }

    return coerceMatchupBucketAssignments(assigned, rows, baselineR, totalR)
  }

  let bucketAssignments = $state<Map<string, string>>(initialAssignments())

  const matchupSideMeta = $derived(buildPickemMatchupSideMetaFromRows(baselineRows))

  const pairIndexBySortedTeamIds = $derived.by(() => {
    const m = new Map<string, number>()
    const pairs = buildPickemMatchupPairsFromRows(baselineRows)
    pairs.forEach(([a, b], i) => {
      m.set([a, b].sort().join('|'), i)
    })
    return m
  })

  function standingBlocksForRows(rows: PickemTeamRow[]): StandingBlock[] {
    const idSet = new Set(rows.map((r) => r.team?.id).filter(Boolean) as string[])
    const sorted = [...rows].sort((a, b) => a.rank - b.rank)
    const used = new Set<string>()
    const out: StandingBlock[] = []
    for (const row of sorted) {
      const id = row.team?.id
      if (!id || used.has(id)) continue
      const meta = matchupSideMeta.get(id)
      if (meta && idSet.has(meta.opponentId) && !used.has(meta.opponentId)) {
        const opp = sorted.find((r) => r.team?.id === meta.opponentId)
        if (opp?.team?.id) {
          used.add(id)
          used.add(meta.opponentId)
          const first = meta.isFirstInPair ? row : opp
          const second = meta.isFirstInPair ? opp : row
          const key = [first.team!.id, second.team!.id].sort().join('|')
          const pairIndex = pairIndexBySortedTeamIds.get(key) ?? 0
          out.push({ kind: 'pair', pairIndex, first, second })
          continue
        }
      }
      out.push({ kind: 'single', row })
    }
    return out
  }

  function pairHue(pairIndex: number) {
    return (pairIndex * 47) % 360
  }

  const bucketCounts = $derived.by(() => {
    const counts = {
      '3-0': 0,
      '2-1': 0,
      '1-2': 0,
      '0-3': 0,
    }

    for (const bucket of bucketAssignments.values()) {
      if (bucket in counts) counts[bucket as keyof typeof counts] += 1
    }

    return counts
  })

  function allowedBucketsForTeam(row: PickemTeamRow): PickemBucket[] {
    const baselineR = Number(data.config.baseline_completed_rounds ?? 2)
    const totalR = Number(data.config.prediction_round ?? 3)
    const base = getAllowedPickemBucketsForRecord(row.wins, row.losses, baselineR, totalR)
    const teamId = row.team?.id
    if (!teamId) return base
    const meta = matchupSideMeta.get(teamId)
    if (!meta) return base
    const oppRow = baselineRows.find((r) => r.team?.id === meta.opponentId)
    if (!oppRow?.team) return base
    const outcomes = getMatchupJointOutcomes(
      row.wins,
      row.losses,
      oppRow.wins,
      oppRow.losses,
      baselineR,
      totalR
    )
    // Always offer both head-to-head outcomes as buttons; narrowing by opponent's current
    // bucket would hide the alternate winner and make it impossible to flip the matchup.
    return matchupAllowedBucketsForSide(meta.isFirstInPair, undefined, outcomes, base)
  }

  function selectedBucket(row: PickemTeamRow) {
    const teamId = row.team?.id
    if (!teamId) return '2-1'
    const allowed = allowedBucketsForTeam(row)
    const fallback = pickDefaultBucket(allowed)
    const raw = bucketAssignments.get(teamId) ?? fallback
    if (!allowed.includes(raw as PickemBucket)) return fallback
    return raw as PickemBucket
  }

  function setBucket(teamId: string | null | undefined, bucket: string) {
    if (!teamId) return
    const baselineR = Number(data.config.baseline_completed_rounds ?? 2)
    const totalR = Number(data.config.prediction_round ?? 3)
    const next = new Map(bucketAssignments).set(teamId, bucket)
    const meta = matchupSideMeta.get(teamId)
    if (meta) {
      const rowSelf = baselineRows.find((r) => r.team?.id === teamId)
      const rowOpp = baselineRows.find((r) => r.team?.id === meta.opponentId)
      if (rowSelf && rowOpp) {
        const outcomes = getMatchupJointOutcomes(
          rowSelf.wins,
          rowSelf.losses,
          rowOpp.wins,
          rowOpp.losses,
          baselineR,
          totalR
        )
        const partner = partnerBucketAfterPick(meta.isFirstInPair, bucket as PickemBucket, outcomes)
        if (partner !== null) next.set(meta.opponentId, partner)
      }
    }
    bucketAssignments = next
  }

  function formatUtc(value: string | null | undefined) {
    if (!value) return 'Not scheduled'
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not scheduled'
  }

  function formatScoredAt(value: string | null | undefined) {
    if (!value) return ''
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : ''
  }

  function buildPayload() {
    const buckets = {
      '3-0': [] as string[],
      '2-1': [] as string[],
      '1-2': [] as string[],
      '0-3': [] as string[],
    }

    for (const row of baselineRows) {
      const teamId = row.team?.id
      if (!teamId) continue
      const bucket = selectedBucket(row)
      if (bucket in buckets) buckets[bucket as keyof typeof buckets].push(teamId)
    }

    return { buckets }
  }

  const baselineRoundCount = $derived(Number(data.config.baseline_completed_rounds ?? 2))

  /** Same standing order as current leaderboard buckets: e.g. 2-0, 1-1, 0-2 */
  const predictionStandingSections = $derived.by(() => {
    const r = baselineRoundCount
    const labels = Array.from({ length: r + 1 }, (_, losses) => {
      const wins = r - losses
      return `${wins}-${losses}`
    })
    const byLabel = new Map<string, PickemTeamRow[]>()
    for (const row of baselineRows) {
      const key = `${row.wins}-${row.losses}`
      const list = byLabel.get(key)
      if (list) list.push(row)
      else byLabel.set(key, [row])
    }
    for (const list of byLabel.values()) {
      list.sort((a, b) => a.rank - b.rank)
    }
    return labels.map((label) => ({ label, rows: byLabel.get(label) ?? [] }))
  })

  const SUBMIT_CONFIRM =
    "You can only submit once for this pick'em. After you submit, you won't be able to change your picks. Continue?"

  async function saveSubmission() {
    if (!viewer) {
      window.location.href = `/auth/login?returnTo=${encodeURIComponent(`/pickems/${data.season.code}`)}`
      return
    }

    if (isSubmitted || isLocked) return

    if (!window.confirm(SUBMIT_CONFIRM)) return

    isSaving = true
    saveMessage = null
    saveError = null

    try {
      const response = await fetch(`/api/pickems/${data.season.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.status === 409) {
        throw new Error(
          typeof payload.message === 'string'
            ? payload.message
            : 'You can only submit once for this pickem.'
        )
      }
      if (!response.ok) throw new Error(payload.message ?? 'Failed to save pickem submission')

      saveMessage = 'Pick submitted. Your picks are saved below (read-only).'
      await invalidateAll()
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'Failed to save pickem submission'
    } finally {
      isSaving = false
    }
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl space-y-6">
      {#if isSubmitted}
        <section>
          <PickemReceipt
            seasonName={data.season.name}
            userName={viewer?.displayName ?? 'You'}
            submittedAt={submissionMeta?.updatedAt ?? null}
            {baselineRows}
            {bucketAssignments}
            pickAccuracyByTeamId={receiptPickAccuracyByTeamId}
          />
        </section>
      {:else}
        <section class="info-card info-card-surface">
          <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 class="responsive-title">{data.season.name} Pick'ems</h1>
              <p class="text-sm" style="color: rgba(255,255,255,0.72);">
                Predict each team's final swiss bucket after round 3. You can submit once—after
                that, you can view your picks here{#if !hasScoredLeaderboard}
                  (points and leaderboards will come later){/if}{#if hasScoredLeaderboard}. Final
                  scores are posted in the leaderboard below{/if}.
              </p>
              {#if data.sourceBatch}
                <p class="mt-1 text-xs" style="color: rgba(255,255,255,0.58);">
                  Frozen from {data.sourceBatch.display_name}
                  {#if data.sourceBatch.as_of_date}
                    <span> • As of {data.sourceBatch.as_of_date}</span>
                  {/if}
                </p>
              {/if}
            </div>
            <div class="text-sm" style="color: rgba(255,255,255,0.78);">
              Lock: {formatUtc(data.config.lock_at)}
            </div>
          </div>

          {#if data.baselineError}
            <p class="mt-4 text-sm" style="color: #fda4af;">{data.baselineError}</p>
          {:else}
            <p class="mt-4 text-sm" style="color: rgba(255,255,255,0.7);">
              Current standings already include {baselineRoundCount} matches played. Zero round differential
              is valid for FF and admin-decision results.
            </p>
          {/if}
        </section>
      {/if}

      {#if !isSubmitted}
        {#if !hasScoredLeaderboard}
          <section class="info-card info-card-surface py-3 sm:py-4">
            <h2 class="mb-2 text-base font-semibold" style="color: var(--text);">
              Current Standings
            </h2>

            <div
              class="overflow-hidden rounded-md border text-[11px] leading-snug"
              style="border-color: rgba(255,255,255,0.08); background: rgba(0,0,0,0.12);"
            >
              {#each Object.entries(data.baselineBuckets ?? {}) as [bucket, rows] (bucket)}
                <div
                  class="flex flex-col gap-1 border-t px-2 py-1.5 first:border-t-0 sm:flex-row sm:items-baseline sm:gap-2 sm:py-1"
                  style="border-color: rgba(255,255,255,0.06);"
                >
                  <div class="flex shrink-0 items-baseline gap-1 sm:w-[3.25rem]">
                    <span class="font-semibold tabular-nums" style="color: var(--text);"
                      >{bucket}</span
                    >
                    <span style="color: rgba(255,255,255,0.38);">({rows.length})</span>
                  </div>
                  <p class="min-w-0 flex-1 break-words" style="color: rgba(255,255,255,0.68);">
                    {#each rows as row, i (row.team?.id ?? i)}
                      {#if i > 0}
                        <span> , </span>
                      {/if}
                      <span title={`${pickemTeamFullLabel(row.team)} · RD ${row.round_diff}`}>
                        {pickemTeamShortLabel(row.team)}
                      </span>
                    {/each}
                  </p>
                </div>
              {/each}
            </div>
          </section>
        {/if}

        <section class="info-card info-card-surface">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold" style="color: var(--text);">Bucket Prediction</h2>
              <p class="text-xs" style="color: rgba(255,255,255,0.62);">
                Paired teams meet in the next Swiss round—each matchup has two outcomes; changing
                one side updates the other. Pick final 3-0 / 2-1 / 1-2 / 0-3. Once you submit, you
                cannot change your picks.
              </p>
            </div>
            <div class="flex flex-wrap gap-2 text-xs">
              {#each bucketOptions as bucket (bucket)}
                <span
                  class="rounded-full px-2 py-1"
                  style="background: rgba(255,255,255,0.08); color: var(--text);"
                >
                  {bucketLabels[bucket]}: {bucketCounts[bucket]}/{expectedCounts[bucket]}
                </span>
              {/each}
            </div>
          </div>

          {#if saveError}
            <p class="mb-3 text-sm" style="color: #fda4af;">{saveError}</p>
          {/if}
          {#if saveMessage}
            <p class="mb-3 text-sm" style="color: #86efac;">{saveMessage}</p>
          {/if}

          <div class="space-y-8" role="region" aria-label="Bucket prediction by current standing">
            {#each predictionStandingSections as { label, rows } (label)}
              {#if rows.length > 0}
                {@const blocks = standingBlocksForRows(rows)}
                <section aria-labelledby="pickem-standing-{label}">
                  <div
                    class="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b pb-2"
                    style="border-color: rgba(255,255,255,0.08);"
                  >
                    <h3
                      id="pickem-standing-{label}"
                      class="text-sm font-semibold tracking-tight"
                      style="color: var(--text);"
                    >
                      Current {label}
                    </h3>
                    <span class="text-[11px]" style="color: rgba(255,255,255,0.48);">
                      {rows.length} team{rows.length === 1 ? '' : 's'} — final bucket
                    </span>
                  </div>
                  <div
                    class="pickem-standing-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                  >
                    {#each blocks as block (block.kind === 'pair' ? `p-${block.first.team?.id}-${block.second.team?.id}` : `s-${block.row.team?.id}`)}
                      {#if block.kind === 'pair'}
                        {@const h = pairHue(block.pairIndex)}
                        <div
                          class="pickem-duel sm:col-span-2 lg:col-span-3 xl:col-span-4"
                          style="--pickem-pair-hue: {h};"
                          aria-label="Matchup: {pickemTeamFullLabel(
                            block.first.team
                          )} versus {pickemTeamFullLabel(block.second.team)}"
                        >
                          <div class="pickem-duel__grid">
                            <PickemTeamBucketRow
                              row={block.first}
                              isLocked={bucketsDisabled}
                              selected={selectedBucket(block.first)}
                              allowed={allowedBucketsForTeam(block.first)}
                              {bucketLabels}
                              shortLabel={pickemTeamShortLabel(block.first.team)}
                              fullLabel={pickemTeamFullLabel(block.first.team)}
                              dense={true}
                              onPick={(b) => setBucket(block.first.team?.id, b)}
                            />
                            <div class="pickem-duel__vs" aria-hidden="true">
                              <span class="pickem-duel__vs-text">VS</span>
                            </div>
                            <PickemTeamBucketRow
                              row={block.second}
                              isLocked={bucketsDisabled}
                              selected={selectedBucket(block.second)}
                              allowed={allowedBucketsForTeam(block.second)}
                              {bucketLabels}
                              shortLabel={pickemTeamShortLabel(block.second.team)}
                              fullLabel={pickemTeamFullLabel(block.second.team)}
                              dense={true}
                              onPick={(b) => setBucket(block.second.team?.id, b)}
                            />
                          </div>
                        </div>
                      {:else}
                        <div class="min-w-0">
                          <PickemTeamBucketRow
                            row={block.row}
                            isLocked={bucketsDisabled}
                            selected={selectedBucket(block.row)}
                            allowed={allowedBucketsForTeam(block.row)}
                            {bucketLabels}
                            shortLabel={pickemTeamShortLabel(block.row.team)}
                            fullLabel={pickemTeamFullLabel(block.row.team)}
                            onPick={(b) => setBucket(block.row.team?.id, b)}
                          />
                        </div>
                      {/if}
                    {/each}
                  </div>
                </section>
              {/if}
            {/each}
          </div>

          <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div class="text-xs" style="color: rgba(255,255,255,0.62);">
              {#if submissionMeta}
                Submitted {formatUtc(submissionMeta.updatedAt)}
              {:else}
                Not submitted yet.
              {/if}
            </div>
            <button
              type="button"
              class="rounded-md px-4 py-2 text-sm font-semibold"
              style="background: rgba(59,130,246,0.18); color: #93c5fd;"
              onclick={saveSubmission}
              disabled={isSaving || bucketsDisabled || Boolean(data.baselineError)}
            >
              {#if isSubmitted}
                Submitted
              {:else if isLocked}
                Locked
              {:else if isSaving}
                Submitting...
              {:else}
                Submit pick'em
              {/if}
            </button>
          </div>
        </section>
      {/if}

      {#if isSubmitted && !hasScoredLeaderboard}
        <section class="info-card info-card-surface py-3 sm:py-4">
          <h2 class="mb-2 text-base font-semibold" style="color: var(--text);">
            Current Standings
          </h2>

          <div
            class="overflow-hidden rounded-md border text-[11px] leading-snug"
            style="border-color: rgba(255,255,255,0.08); background: rgba(0,0,0,0.12);"
          >
            {#each Object.entries(data.baselineBuckets ?? {}) as [bucket, rows] (bucket)}
              <div
                class="flex flex-col gap-1 border-t px-2 py-1.5 first:border-t-0 sm:flex-row sm:items-baseline sm:gap-2 sm:py-1"
                style="border-color: rgba(255,255,255,0.06);"
              >
                <div class="flex shrink-0 items-baseline gap-1 sm:w-[3.25rem]">
                  <span class="font-semibold tabular-nums" style="color: var(--text);"
                    >{bucket}</span
                  >
                  <span style="color: rgba(255,255,255,0.38);">({rows.length})</span>
                </div>
                <p class="min-w-0 flex-1 break-words" style="color: rgba(255,255,255,0.68);">
                  {#each rows as row, i (row.team?.id ?? i)}
                    {#if i > 0}
                      <span> , </span>
                    {/if}
                    <span title={`${pickemTeamFullLabel(row.team)} · RD ${row.round_diff}`}>
                      {pickemTeamShortLabel(row.team)}
                    </span>
                  {/each}
                </p>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <section class="info-card info-card-surface pickem-lb" aria-labelledby="pickem-lb-heading">
        {#if hasScoredLeaderboard}
          <div class="pickem-lb__intro mb-5">
            <h2 id="pickem-lb-heading" class="pickem-lb__title">Leaderboard</h2>
            <p class="pickem-lb__subtitle">
              Final results — one point per team placed in the correct final bucket ({pickemMaxPoints}
              max).
            </p>
            {#if pickemLeaderboard[0]?.scoredAt}
              <p class="pickem-lb__meta">
                Scored {formatScoredAt(pickemLeaderboard[0].scoredAt)}
              </p>
            {/if}
          </div>

          <ol class="pickem-lb__list" aria-label="Pick'em leaderboard by score">
            {#each pickemLeaderboard as row, i (row.id)}
              {@const tier =
                row.rank === 1
                  ? 'gold'
                  : row.rank === 2
                    ? 'silver'
                    : row.rank === 3
                      ? 'bronze'
                      : 'rest'}
              {@const missCount = row.wrongPicks?.length ?? 0}
              {@const isDetailOpen = Boolean(pickemLbExpanded[row.id])}
              <li class="pickem-lb__item" data-tier={tier} style="--lb-stagger: {i * 42}ms;">
                <div class="pickem-lb__row">
                  <div class="pickem-lb__rank" aria-label="Rank {row.rank}">
                    <span class="pickem-lb__rank-num">{row.rank}</span>
                  </div>
                  <div class="pickem-lb__main">
                    <span class="pickem-lb__name">{row.user.name}</span>
                    {#if missCount > 0}
                      <button
                        type="button"
                        class="pickem-lb__miss-toggle"
                        class:pickem-lb__miss-toggle--open={isDetailOpen}
                        aria-expanded={isDetailOpen}
                        aria-controls="pickem-lb-misses-{row.id}"
                        aria-label={isDetailOpen
                          ? `Hide incorrect picks for ${row.user.name}`
                          : `Show incorrect picks for ${row.user.name}`}
                        onclick={() => pickemLbToggle(row.id)}
                      >
                        <span class="pickem-lb__miss-chevron" aria-hidden="true">
                          <ChevronDown size={15} strokeWidth={2.25} />
                        </span>
                      </button>
                    {/if}
                  </div>
                  <div class="pickem-lb__score-block">
                    <span class="pickem-lb__score">{row.score}</span>
                    <span class="pickem-lb__score-denom">/{pickemMaxPoints}</span>
                  </div>
                </div>
                {#if missCount > 0 && isDetailOpen}
                  <div
                    class="pickem-lb__misses"
                    id="pickem-lb-misses-{row.id}"
                    role="region"
                    aria-label="Incorrect picks for {row.user.name}"
                  >
                    <p class="pickem-lb__misses-heading">Incorrect picks</p>
                    <ul class="pickem-lb__miss-list">
                      {#each row.wrongPicks as w (w.teamId)}
                        {@const letter = wrongPickOutcomeLetter(w)}
                        <li class="pickem-lb__miss-line">
                          <span class="pickem-lb__miss-team" title={w.name}
                            >{wrongPickTeamLabel(w)}</span
                          >
                          <span class="pickem-lb__miss-sep" aria-hidden="true"> — </span>
                          <span
                            class="pickem-lb__miss-out"
                            class:pickem-lb__miss-out--w={letter === 'W'}
                            class:pickem-lb__miss-out--l={letter === 'L'}
                            aria-label={wrongPickOutcomeAria(w)}>{letter}</span
                          >
                        </li>
                      {/each}
                    </ul>
                  </div>
                {/if}
              </li>
            {/each}
          </ol>
        {:else}
          <h2 id="pickem-lb-heading" class="mb-2 text-lg font-semibold" style="color: var(--text);">
            Submitted
          </h2>
          <p class="mb-4 text-sm" style="color: rgba(255,255,255,0.62);">
            People who have locked in their pick'em (scores appear after the season is scored).
          </p>
          {#if submissionsList.length === 0}
            <p class="text-sm" style="color: rgba(255,255,255,0.72);">No submissions yet.</p>
          {:else}
            <ul class="space-y-2">
              {#each submissionsList as row (row.id)}
                <li
                  class="rounded-md border px-3 py-2 text-sm"
                  style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18); color: rgba(255,255,255,0.82);"
                >
                  {row.user.name}
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </section>
    </div>
  </div>
</PageContainer>

<style>
  .pickem-duel {
    border-radius: 0.875rem;
    padding: 0.65rem 0.75rem 0.75rem;
    border: 1px solid hsl(var(--pickem-pair-hue) 52% 48% / 0.38);
    background: linear-gradient(
      155deg,
      hsl(var(--pickem-pair-hue) 42% 16% / 0.42) 0%,
      rgba(8, 10, 18, 0.72) 48%,
      hsl(var(--pickem-pair-hue) 38% 10% / 0.35) 100%
    );
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.45),
      inset 0 1px 0 hsl(var(--pickem-pair-hue) 65% 58% / 0.14);
  }

  .pickem-duel__grid {
    display: grid;
    grid-template-columns: 1fr;
    align-items: stretch;
    gap: 0.5rem;
  }

  @media (min-width: 640px) {
    .pickem-duel__grid {
      grid-template-columns: 1fr auto 1fr;
      gap: 0.35rem 0.5rem;
      align-items: center;
    }
  }

  .pickem-duel__vs {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem 0;
  }

  @media (min-width: 640px) {
    .pickem-duel__vs {
      padding: 0 0.15rem;
    }
  }

  .pickem-duel__vs-text {
    font-family: 'Nippo', ui-sans-serif, system-ui, sans-serif;
    font-size: 0.85rem;
    font-weight: 800;
    letter-spacing: 0.18em;
    color: hsl(var(--pickem-pair-hue) 82% 68% / 0.95);
    text-shadow: 0 0 22px hsl(var(--pickem-pair-hue) 70% 55% / 0.35);
  }

  /* Pick'em public leaderboard (post-scoring) */
  .pickem-lb {
    position: relative;
    overflow: hidden;
    border-color: rgba(255, 255, 255, 0.12) !important;
    background: rgba(0, 0, 0, 0.22);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.06),
      0 18px 40px rgba(0, 0, 0, 0.35);
  }

  .pickem-lb::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E");
    opacity: 0.45;
    pointer-events: none;
    mix-blend-mode: overlay;
  }

  .pickem-lb__intro {
    position: relative;
    z-index: 1;
  }

  .pickem-lb__title {
    font-family: 'Nippo', ui-sans-serif, system-ui, sans-serif;
    font-size: clamp(1.75rem, 4vw, 2.35rem);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.1;
    color: var(--title);
    text-shadow: 0 2px 24px rgba(94, 52, 114, 0.65);
    margin: 0 0 0.35rem;
  }

  .pickem-lb__subtitle {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.45;
    color: rgba(255, 255, 255, 0.68);
    max-width: 42rem;
  }

  .pickem-lb__meta {
    margin: 0.65rem 0 0;
    font-size: 0.75rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.45);
  }

  .pickem-lb__list {
    position: relative;
    z-index: 1;
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .pickem-lb__item {
    border-radius: 0.65rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(8, 10, 20, 0.55);
    animation: pickem-lb-row-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    animation-delay: var(--lb-stagger, 0ms);
    opacity: 0;
    overflow: hidden;
  }

  .pickem-lb__row {
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.65rem 0.85rem;
    padding: 0.65rem 0.85rem;
  }

  @keyframes pickem-lb-row-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .pickem-lb__item[data-tier='gold'] {
    border-color: rgba(250, 204, 21, 0.45);
    background: linear-gradient(
      105deg,
      rgba(250, 204, 21, 0.14) 0%,
      rgba(8, 10, 20, 0.65) 42%,
      rgba(8, 10, 20, 0.55) 100%
    );
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.35),
      inset 0 1px 0 rgba(253, 230, 138, 0.12);
  }

  .pickem-lb__item[data-tier='silver'] {
    border-color: rgba(203, 213, 225, 0.35);
    background: linear-gradient(
      105deg,
      rgba(226, 232, 240, 0.12) 0%,
      rgba(8, 10, 20, 0.62) 45%,
      rgba(8, 10, 20, 0.52) 100%
    );
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }

  .pickem-lb__item[data-tier='bronze'] {
    border-color: rgba(180, 83, 9, 0.42);
    background: linear-gradient(
      105deg,
      rgba(251, 146, 60, 0.12) 0%,
      rgba(8, 10, 20, 0.62) 45%,
      rgba(8, 10, 20, 0.52) 100%
    );
    box-shadow: inset 0 1px 0 rgba(254, 215, 170, 0.08);
  }

  .pickem-lb__rank {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 2.5rem;
  }

  .pickem-lb__rank-num {
    font-family: 'Nippo', ui-sans-serif, system-ui, sans-serif;
    font-size: 1.35rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.92);
    text-shadow: 0 0 18px rgba(99, 102, 241, 0.35);
  }

  .pickem-lb__main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .pickem-lb__name {
    font-weight: 600;
    font-size: 0.95rem;
    color: rgba(255, 255, 255, 0.92);
    word-break: break-word;
  }

  .pickem-lb__miss-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    min-width: 1.75rem;
    min-height: 1.75rem;
    padding: 0.25rem;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 0.4rem;
    background: rgba(0, 0, 0, 0.28);
    cursor: pointer;
    font-size: 0.72rem;
    letter-spacing: 0.02em;
    color: rgba(255, 255, 255, 0.72);
    line-height: 1.2;
  }

  .pickem-lb__miss-toggle:hover {
    border-color: rgba(255, 255, 255, 0.22);
    background: rgba(0, 0, 0, 0.38);
    color: rgba(255, 255, 255, 0.88);
  }

  .pickem-lb__miss-toggle:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.45);
    outline-offset: 2px;
  }

  .pickem-lb__miss-chevron {
    display: flex;
    flex-shrink: 0;
    color: rgba(255, 255, 255, 0.55);
    transition: transform 0.2s ease;
  }

  .pickem-lb__miss-toggle:hover .pickem-lb__miss-chevron {
    color: rgba(255, 255, 255, 0.78);
  }

  .pickem-lb__miss-toggle--open .pickem-lb__miss-chevron {
    transform: rotate(180deg);
  }

  .pickem-lb__misses {
    padding: 0 0.85rem 0.75rem;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    margin-top: 0;
  }

  .pickem-lb__misses-heading {
    margin: 0.5rem 0 0.35rem;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.42);
  }

  .pickem-lb__miss-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .pickem-lb__miss-line {
    font-size: 0.8rem;
    line-height: 1.35;
    color: rgba(255, 255, 255, 0.82);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.15rem 0.25rem;
  }

  .pickem-lb__miss-team {
    font-weight: 500;
    min-width: 0;
    word-break: break-word;
  }

  .pickem-lb__miss-sep {
    color: rgba(255, 255, 255, 0.35);
    flex-shrink: 0;
  }

  .pickem-lb__miss-out {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.25rem;
    height: 1.25rem;
    border-radius: 0.25rem;
    font-family: 'Nippo', ui-sans-serif, system-ui, sans-serif;
    font-size: 0.72rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .pickem-lb__miss-out--w {
    color: #86efac;
    background: rgba(34, 197, 94, 0.18);
    box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.35);
  }

  .pickem-lb__miss-out--l {
    color: #fca5a5;
    background: rgba(239, 68, 68, 0.16);
    box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.4);
  }

  .pickem-lb__score-block {
    display: flex;
    align-items: baseline;
    gap: 0.1rem;
    justify-self: end;
  }

  .pickem-lb__score {
    font-family: 'Nippo', ui-sans-serif, system-ui, sans-serif;
    font-size: 1.5rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: #fef3c7;
    text-shadow: 0 0 20px rgba(251, 191, 36, 0.25);
  }

  .pickem-lb__score-denom {
    font-size: 0.8rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.42);
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 420px) {
    .pickem-lb__row {
      grid-template-columns: 2.5rem minmax(0, 1fr) auto;
      padding: 0.55rem 0.65rem;
    }

    .pickem-lb__misses {
      padding-left: 0.65rem;
      padding-right: 0.65rem;
    }

    .pickem-lb__score {
      font-size: 1.25rem;
    }
  }
</style>
