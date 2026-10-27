<script lang="ts">
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import AdminRiotAccountsPanel from '$lib/components/admin/AdminRiotAccountsPanel.svelte'
  import { resolve } from '$app/paths'
  import { SIGNUP_RANK_OPTIONS, computePlayerScore, roundRating } from '$lib/signups/formula'
  import { signupsToCsv } from '$lib/signups/export-csv'
  import type { PlayerSignup, SignupEditState } from '$lib/admin/types'

  type BulkImportReport = {
    processed: number
    updated: number
    skipped: number
    failed: number
    stoppedEarly: boolean
    remaining: number
    rows: Array<{ id: string; name: string; outcome: string; detail: string }>
  }

  interface Props {
    signups: PlayerSignup[]
    signupsLoaded: boolean
    statusFilter: string
    editForm: Record<string, SignupEditState>
    processingSignupId: string | null
    onStatusFilterChange: (value: string) => void
    onEditChange: (signupId: string, patch: Partial<SignupEditState>) => void
    /** Signup whose Riot lookup is in flight, or null. */
    riotLookupSignupId?: string | null
    onFetchRiotRank: (signupId: string) => void
    bulkImportRunning?: boolean
    bulkImportReport?: BulkImportReport | null
    /** Rows checked so far in a running bulk import. */
    bulkImportProgress?: { done: number; total: number } | null
    onBulkImport: (overwrite: boolean) => void
    onStopBulkImport: () => void
    onDismissBulkReport: () => void
    onSave: (signupId: string) => void
    onSetStatus: (signupId: string, status: 'pending' | 'approved' | 'rejected') => void
    onDelete: (signupId: string, name: string) => void
    /** Save just the adjustment; null removes it. */
    onSetAdjustment: (signupId: string, adjustment: number | null) => void
    /** An alternate Riot account was approved or rejected. */
    onRiotAccountReviewed?: () => void
  }

  let {
    signups,
    signupsLoaded,
    statusFilter,
    editForm,
    processingSignupId,
    onStatusFilterChange,
    onEditChange,
    riotLookupSignupId = null,
    onFetchRiotRank,
    bulkImportRunning = false,
    bulkImportReport = null,
    bulkImportProgress = null,
    onBulkImport,
    onStopBulkImport,
    onDismissBulkReport,
    onSave,
    onSetStatus,
    onDelete,
    onSetAdjustment,
    onRiotAccountReviewed,
  }: Props = $props()

  let expandedId = $state<string | null>(null)
  let bulkOverwrite = $state(false)

  function outcomeStyle(outcome: string) {
    if (outcome === 'updated') return 'background: rgba(74,222,128,0.16); color: #86efac;'
    if (outcome === 'failed') return 'background: rgba(248,113,113,0.16); color: #fca5a5;'
    return 'background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6);'
  }

  const statusFilterOptions = [
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'all', label: 'All' },
  ]

  const rankOptions = [{ value: '', label: '— None —' }, ...SIGNUP_RANK_OPTIONS]

  function stateFor(signup: PlayerSignup): SignupEditState {
    return (
      editForm[signup.id] ?? {
        displayName: signup.display_name ?? '',
        discordHandle: signup.discord_handle ?? '',
        currentRank: signup.current_rank ?? '',
        peakRank: signup.peak_rank ?? '',
        manualAdjustment: Number(signup.manual_adjustment ?? 0)
          ? String(signup.manual_adjustment)
          : '',
      }
    )
  }

  /**
   * Live score from the edited ranks, so an admin sees the effect before
   * saving. The adjustment shown is the applied one, not the draft in the box.
   */
  function scoreFor(signup: PlayerSignup, state: SignupEditState) {
    const score = computePlayerScore({
      currentRank: state.currentRank || null,
      peakRank: state.peakRank || null,
      rating: signup.rating,
    })
    const adjustment = Number(signup.manual_adjustment ?? 0)
    return {
      ...score,
      adjustment,
      final: score.total == null ? null : roundRating(score.total + adjustment),
    }
  }

  const fmt = (n: number | null, digits = 2) => (n == null ? '—' : n.toFixed(digits))
  const signed = (n: number) => `${n < 0 ? '−' : '+'}${Math.abs(n).toFixed(2)}`

  /** Download the signups in the current filter as a CSV. */
  function exportSignupsCsv() {
    const blob = new Blob(
      [signupsToCsv(signups.map((s) => ({ ...s, score: effectiveValue(s) })))],
      { type: 'text/csv;charset=utf-8' }
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `signups-${statusFilter}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  function statusStyle(status: string) {
    if (status === 'pending') return 'background: rgba(251,191,36,0.16); color: #fcd34d;'
    if (status === 'approved') return 'background: rgba(74,222,128,0.16); color: #86efac;'
    return 'background: rgba(248,113,113,0.16); color: #fca5a5;'
  }

  function effectiveValue(signup: PlayerSignup) {
    if (signup.manual_value_override != null) return signup.manual_value_override
    if (signup.computed_value == null) return null
    return roundRating(Number(signup.computed_value) + Number(signup.manual_adjustment ?? 0))
  }
</script>

<AdminRiotAccountsPanel onReviewed={onRiotAccountReviewed} />

<section class="admin-bordered p-3">
  <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
    <div
      class="text-sm font-semibold tracking-wide uppercase"
      style="color: rgba(255,255,255,0.8);"
    >
      Player Signups ({signups.length})
    </div>
    <div class="w-full md:w-48">
      <CustomSelect
        options={statusFilterOptions}
        value={statusFilter}
        compact={true}
        placeholder="Filter by status"
        onSelect={onStatusFilterChange}
      />
    </div>
  </div>

  <!-- Bulk import: one pass over the filtered list instead of row-by-row. -->
  <div
    class="mb-3 rounded-md p-3"
    style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.10);"
  >
    <div class="flex flex-wrap items-center gap-2">
      <span
        class="text-[10px] font-bold tracking-wide uppercase"
        style="color: rgba(255,255,255,0.6);"
      >
        Bulk fill
      </span>
      <button
        type="button"
        class="admin-btn admin-btn-sm admin-btn-info"
        disabled={bulkImportRunning}
        title="Fetch current rank and peak since V26 Act 1 for every signup in this filter"
        onclick={() => onBulkImport(bulkOverwrite)}
      >
        Ranks from Riot
      </button>
      {#if bulkImportRunning}
        <button
          type="button"
          class="admin-btn admin-btn-sm admin-btn-neutral"
          title="Stop after the current batch; rows already filled stay saved"
          onclick={onStopBulkImport}
        >
          Stop
        </button>
      {/if}
      <button
        type="button"
        class="admin-btn admin-btn-sm admin-btn-accent"
        disabled={signups.length === 0}
        title="Download every signup in this filter as a CSV: Riot ID, Discord and final score"
        onclick={exportSignupsCsv}
      >
        Bulk output
      </button>

      <label class="ml-auto flex items-center gap-2 text-xs" style="color: rgba(255,255,255,0.72);">
        <input type="checkbox" bind:checked={bulkOverwrite} disabled={bulkImportRunning} />
        Overwrite existing values
      </label>
    </div>

    <p class="mt-2 text-[11px]" style="color: rgba(255,255,255,0.6);">
      {#if bulkImportRunning}
        {#if bulkImportProgress}
          <strong style="color: rgba(255,255,255,0.82);">
            {bulkImportProgress.done} / {bulkImportProgress.total}
          </strong>
          checked.
        {/if}
        Running — Riot lookups are paced to stay under the API's rate limit (about 30 a minute), so a
        few hundred players take several minutes. Leave this tab open.
      {:else}
        Applies to the <strong style="color: rgba(255,255,255,0.82);">{statusFilter}</strong> filter and
        saves directly. Rows that already have values are skipped unless overwrite is on, and a manual
        override is never touched.
      {/if}
    </p>
  </div>

  {#if bulkImportReport}
    <div
      class="mb-3 rounded-md p-3"
      style="background: rgba(120,67,145,0.08); border: 1px solid rgba(120,67,145,0.28);"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs font-semibold" style="color: rgba(255,255,255,0.85);">
          {bulkImportReport.updated} updated · {bulkImportReport.skipped} skipped · {bulkImportReport.failed}
          failed
          {#if bulkImportReport.stoppedEarly && !bulkImportRunning}
            <span style="color: #fcd34d;">
              · stopped with {bulkImportReport.remaining} left, run again to continue
            </span>
          {/if}
        </span>
        <button
          type="button"
          class="admin-btn admin-btn-sm admin-btn-neutral"
          onclick={onDismissBulkReport}
        >
          Dismiss
        </button>
      </div>

      {#if bulkImportReport.rows.length > 0}
        <ul class="mt-2 max-h-56 overflow-y-auto text-[11px]">
          {#each bulkImportReport.rows as row (row.id)}
            <li class="flex flex-wrap items-baseline gap-2 py-0.5">
              <span
                class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                style={outcomeStyle(row.outcome)}
              >
                {row.outcome}
              </span>
              <span style="color: rgba(255,255,255,0.82);">{row.name}</span>
              <span style="color: rgba(255,255,255,0.6);">{row.detail}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if !signupsLoaded}
    <div class="py-10 text-center text-sm" style="color: rgba(255,255,255,0.72);">
      Loading signups...
    </div>
  {:else if signups.length === 0}
    <div class="py-10 text-center text-sm" style="color: rgba(255,255,255,0.72);">
      No signups match this filter.
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-2">
      {#each signups as signup (signup.id)}
        {@const state = stateFor(signup)}
        {@const score = scoreFor(signup, state)}
        {@const isExpanded = expandedId === signup.id}
        <article
          class="rounded-md border"
          style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.2);"
        >
          <button
            type="button"
            class="flex w-full items-center gap-3 p-3 text-left"
            style="cursor: pointer;"
            onclick={() => (expandedId = isExpanded ? null : signup.id)}
          >
            <span
              class="inline-block text-xs"
              style="color: rgba(255,255,255,0.5); transform: rotate({isExpanded
                ? '90deg'
                : '0deg'});">▶</span
            >
            <span
              class="rounded px-2 py-0.5 text-[10px] font-bold uppercase"
              style={statusStyle(signup.status)}
            >
              {signup.status}
            </span>
            <span class="min-w-0 flex-1 truncate text-sm font-semibold" style="color: var(--text);">
              {signup.display_name ?? signup.profile.name}
              {#if signup.current_rank}
                <span style="color: rgba(255,255,255,0.5);"> · {signup.current_rank}</span>
              {/if}
            </span>
            {#if effectiveValue(signup) != null}
              <span
                class="rounded px-2 py-0.5 text-xs font-bold"
                style="background: rgba(120,67,145,0.2); color: #d8b4fe; font-variant-numeric: tabular-nums;"
              >
                {effectiveValue(signup)}
                {#if signup.manual_value_override != null}
                  <span style="opacity: 0.7;"> (manual)</span>
                {:else if Number(signup.manual_adjustment ?? 0) !== 0}
                  <span style="opacity: 0.7;"> (adj)</span>
                {/if}
              </span>
            {/if}
          </button>

          {#if isExpanded}
            <div class="px-3 pb-3">
              <!-- Submitted info -->
              <div class="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <a
                  href={resolve(`/players/${signup.profile.id}`)}
                  class="font-semibold"
                  style="color: #93c5fd;"
                >
                  View profile →
                </a>
                {#if signup.discord_handle}
                  <span style="color: rgba(255,255,255,0.6);">
                    Discord: <strong style="color: rgba(255,255,255,0.85);"
                      >{signup.discord_handle}</strong
                    >
                  </span>
                {/if}
                <span style="color: rgba(255,255,255,0.6);">
                  Submitted {new Date(signup.created_at).toLocaleDateString()}
                </span>
              </div>

              <!-- Tracker links to verify by eye, beside the lookup that fills the ranks. -->
              <div class="mb-3 flex flex-wrap items-center gap-2">
                {#each signup.tracker_links ?? [] as link (link.url)}
                  <!-- eslint-disable svelte/no-navigation-without-resolve -->
                  <!-- External tracker URLs, not app routes -->
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="admin-btn admin-btn-sm admin-btn-info"
                  >
                    {link.label} ↗
                  </a>
                  <!-- eslint-enable svelte/no-navigation-without-resolve -->
                {/each}
                <button
                  type="button"
                  class="admin-btn admin-btn-sm admin-btn-info"
                  disabled={riotLookupSignupId === signup.id}
                  title="Look up by the player's linked Riot account, or the Riot ID on the signup"
                  onclick={() => onFetchRiotRank(signup.id)}
                >
                  {riotLookupSignupId === signup.id ? 'Looking up...' : 'Fetch rank from Riot'}
                </button>
                {#if signup.riot_tag}
                  <span class="text-[11px]" style="color: rgba(255,255,255,0.64);">
                    {signup.display_name}#{signup.riot_tag}
                  </span>
                {:else}
                  <span class="text-[11px]" style="color: #fcd34d;">
                    No tagline on this signup — the lookup needs a linked Riot account.
                  </span>
                {/if}
              </div>

              <!-- Editable fields -->
              <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                  Display Name
                  <input
                    value={state.displayName}
                    class="admin-input mt-1"
                    oninput={(e) =>
                      onEditChange(signup.id, {
                        displayName: (e.currentTarget as HTMLInputElement).value,
                      })}
                  />
                </label>
                <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                  Discord
                  <input
                    value={state.discordHandle}
                    class="admin-input mt-1"
                    oninput={(e) =>
                      onEditChange(signup.id, {
                        discordHandle: (e.currentTarget as HTMLInputElement).value,
                      })}
                  />
                </label>
              </div>

              <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                  Current Rank
                  <div class="mt-1">
                    <CustomSelect
                      options={rankOptions}
                      value={state.currentRank}
                      compact={true}
                      placeholder="None"
                      onSelect={(value) => onEditChange(signup.id, { currentRank: value })}
                    />
                  </div>
                </label>
                <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                  Peak Rank
                  <div class="mt-1">
                    <CustomSelect
                      options={rankOptions}
                      value={state.peakRank}
                      compact={true}
                      placeholder="None"
                      onSelect={(value) => onEditChange(signup.id, { peakRank: value })}
                    />
                  </div>
                </label>
              </div>

              <!-- Score breakdown and adjustment -->
              <div
                class="mt-3 flex flex-wrap items-end justify-between gap-3 rounded-md p-3"
                style="background: rgba(120,67,145,0.08); border: 1px solid rgba(120,67,145,0.28);"
              >
                <div
                  class="flex flex-col gap-1 text-[11px]"
                  style="color: rgba(255,255,255,0.64); font-variant-numeric: tabular-nums;"
                >
                  <span>
                    0.35 × {fmt(score.currentPoints, 0)} + 0.65 × {fmt(score.peakPoints, 0)}
                    = {fmt(score.weightedRankScore)}
                  </span>
                  <span>
                    Bonus {signed(score.bonus)}
                    {#if signup.rating != null}
                      (rating {signup.rating.toFixed(3)})
                    {:else}
                      (no rating)
                    {/if}
                    {#if score.adjustment !== 0}
                      · Adjustment {signed(score.adjustment)}
                    {/if}
                  </span>
                  <span class="text-sm font-bold" style="color: #d8b4fe;">
                    {#if score.final == null}
                      No score — needs both ranks
                    {:else}
                      Score {fmt(score.final)}
                    {/if}
                  </span>
                </div>

                <div class="flex items-end gap-2">
                  <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                    Manual adjustment
                    <input
                      type="number"
                      step="any"
                      value={state.manualAdjustment}
                      class="admin-input mt-1 w-28"
                      placeholder="0"
                      oninput={(e) =>
                        onEditChange(signup.id, {
                          manualAdjustment: (e.currentTarget as HTMLInputElement).value,
                        })}
                    />
                  </label>
                  <button
                    type="button"
                    class="admin-btn admin-btn-sm admin-btn-info"
                    disabled={processingSignupId === signup.id ||
                      state.manualAdjustment.trim() === '' ||
                      Number(state.manualAdjustment) === score.adjustment}
                    onclick={() => onSetAdjustment(signup.id, Number(state.manualAdjustment))}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    class="admin-btn admin-btn-sm admin-btn-danger"
                    disabled={processingSignupId === signup.id || score.adjustment === 0}
                    onclick={() => onSetAdjustment(signup.id, null)}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  class="admin-btn admin-btn-sm admin-btn-danger"
                  disabled={processingSignupId === signup.id}
                  onclick={() => onDelete(signup.id, signup.display_name ?? signup.profile.name)}
                >
                  Delete
                </button>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="admin-btn admin-btn-sm admin-btn-info"
                    disabled={processingSignupId === signup.id}
                    onclick={() => onSave(signup.id)}
                  >
                    {processingSignupId === signup.id ? 'Saving...' : 'Save'}
                  </button>
                  {#if signup.status !== 'rejected'}
                    <button
                      type="button"
                      class="admin-btn admin-btn-sm admin-btn-danger"
                      disabled={processingSignupId === signup.id}
                      onclick={() => onSetStatus(signup.id, 'rejected')}
                    >
                      Reject
                    </button>
                  {/if}
                  {#if signup.status !== 'approved'}
                    <button
                      type="button"
                      class="admin-btn admin-btn-sm admin-btn-go"
                      disabled={processingSignupId === signup.id}
                      onclick={() => onSetStatus(signup.id, 'approved')}
                    >
                      Approve
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>
