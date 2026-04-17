<script lang="ts">
  import { invalidateAll } from '$app/navigation'

  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
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
  import type { PickemTeamRow } from '$lib/server/pickems'

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
  const viewer = $derived(data.viewer ?? null)
  const submissionMeta = $derived(data.submissionMeta ?? null)
  const isLocked = $derived(Boolean(data.isLocked))
  /** One submission per user; after submit, picks are read-only even before season lock. */
  const isSubmitted = $derived(Boolean(submissionMeta))
  const bucketsDisabled = $derived(isLocked || isSubmitted)

  let saveMessage = $state<string | null>(null)
  let saveError = $state<string | null>(null)
  let isSaving = $state(false)

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

  function formatLocal(value: string | null | undefined) {
    if (!value) return 'Not scheduled'
    const date = new Date(value)
    return Number.isFinite(date.getTime())
      ? date.toLocaleString(undefined, { timeZoneName: 'short' })
      : 'Not scheduled'
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
          />
        </section>
      {:else}
        <section class="info-card info-card-surface">
          <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 class="responsive-title">{data.season.name} Pick'ems</h1>
              <p class="text-sm" style="color: rgba(255,255,255,0.72);">
                Predict each team's final swiss bucket after round 3. You can submit once—after
                that, you can view your picks here (points and leaderboards will come later).
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
              Lock: {formatLocal(data.config.lock_at)}
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
                Submitted {formatLocal(submissionMeta.updatedAt)}
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

      {#if isSubmitted}
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
        <h2 class="mb-2 text-lg font-semibold" style="color: var(--text);">Submitted</h2>
        <p class="mb-4 text-sm" style="color: rgba(255,255,255,0.62);">
          People who have locked in their pick'em (no points shown yet).
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
</style>
