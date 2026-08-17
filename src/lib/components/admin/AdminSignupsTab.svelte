<script lang="ts">
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import AdminRiotAccountsPanel from '$lib/components/admin/AdminRiotAccountsPanel.svelte'
  import { resolve } from '$app/paths'
  import {
    SIGNUP_RANK_OPTIONS,
    computeRatingFromRankNames,
    roundRating,
  } from '$lib/signups/formula'
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
    /** Signup whose tracker.gg lookup is in flight, or null. */
    trackerLookupSignupId?: string | null
    onFetchTrackerScore: (signupId: string) => void
    bulkImportRunning?: boolean
    bulkImportReport?: BulkImportReport | null
    onBulkImport: (source: 'riot' | 'tracker' | 'both', overwrite: boolean) => void
    onDismissBulkReport: () => void
    onSave: (signupId: string) => void
    onSetStatus: (signupId: string, status: 'pending' | 'approved' | 'rejected') => void
    onDelete: (signupId: string, name: string) => void
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
    trackerLookupSignupId = null,
    onFetchTrackerScore,
    bulkImportRunning = false,
    bulkImportReport = null,
    onBulkImport,
    onDismissBulkReport,
    onSave,
    onSetStatus,
    onDelete,
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
        trackerCurrentScore:
          signup.tracker_current_score != null ? String(signup.tracker_current_score) : '',
        trackerPeakScore:
          signup.tracker_peak_score != null ? String(signup.tracker_peak_score) : '',
        manualValueOverride:
          signup.manual_value_override != null ? String(signup.manual_value_override) : '',
        adminNotes: signup.admin_notes ?? '',
      }
    )
  }

  /** Recompute live so an admin sees the effect of an edit before saving. */
  function previewFor(state: SignupEditState) {
    return computeRatingFromRankNames({
      currentRank: state.currentRank || null,
      peakRank: state.peakRank || null,
      trackerCurrentScore:
        state.trackerCurrentScore === '' ? null : Number(state.trackerCurrentScore),
      trackerPeakScore: state.trackerPeakScore === '' ? null : Number(state.trackerPeakScore),
    })
  }

  function statusStyle(status: string) {
    if (status === 'pending') return 'background: rgba(251,191,36,0.16); color: #fcd34d;'
    if (status === 'approved') return 'background: rgba(74,222,128,0.16); color: #86efac;'
    return 'background: rgba(248,113,113,0.16); color: #fca5a5;'
  }

  function effectiveValue(signup: PlayerSignup) {
    return signup.manual_value_override ?? signup.computed_value
  }
</script>

<AdminRiotAccountsPanel />

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
        title="Fetch current and peak rank from Riot for every signup in this filter"
        onclick={() => onBulkImport('riot', bulkOverwrite)}
      >
        Ranks from Riot
      </button>
      <button
        type="button"
        class="admin-btn admin-btn-sm admin-btn-accent"
        disabled={bulkImportRunning}
        title="Read tracker.gg scores for every signup in this filter"
        onclick={() => onBulkImport('tracker', bulkOverwrite)}
      >
        Tracker scores
      </button>
      <button
        type="button"
        class="admin-btn admin-btn-sm admin-btn-accent"
        disabled={bulkImportRunning}
        title="Fetch ranks and tracker scores in one pass"
        onclick={() => onBulkImport('both', bulkOverwrite)}
      >
        Both
      </button>

      <label class="ml-auto flex items-center gap-2 text-xs" style="color: rgba(255,255,255,0.72);">
        <input type="checkbox" bind:checked={bulkOverwrite} disabled={bulkImportRunning} />
        Overwrite existing values
      </label>
    </div>

    <p class="mt-2 text-[11px]" style="color: rgba(255,255,255,0.6);">
      {#if bulkImportRunning}
        Running — requests are paced, so this takes a while. Leave this tab open.
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
          {#if bulkImportReport.stoppedEarly}
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
        {@const isExpanded = expandedId === signup.id}
        {@const preview = previewFor(state)}
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

              {#if (signup.tracker_links ?? []).length > 0}
                <div class="mb-3 flex flex-wrap gap-2">
                  {#each signup.tracker_links as link (link.url)}
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
                </div>
              {/if}

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

              <!-- Riot lookup fills the rank fields; scores stay manual. -->
              <div class="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="admin-btn admin-btn-sm admin-btn-info"
                  disabled={riotLookupSignupId === signup.id || !signup.riot_tag}
                  title={signup.riot_tag
                    ? `Look up ${signup.display_name}#${signup.riot_tag}`
                    : 'This signup has no Riot tagline'}
                  onclick={() => onFetchRiotRank(signup.id)}
                >
                  {riotLookupSignupId === signup.id ? 'Looking up...' : 'Fetch rank from Riot'}
                </button>
                <button
                  type="button"
                  class="admin-btn admin-btn-sm admin-btn-accent"
                  disabled={trackerLookupSignupId === signup.id || !signup.riot_tag}
                  title={signup.riot_tag
                    ? 'Read the tracker.gg performance score for current and peak'
                    : 'This signup has no Riot tagline'}
                  onclick={() => onFetchTrackerScore(signup.id)}
                >
                  {trackerLookupSignupId === signup.id
                    ? 'Reading tracker...'
                    : 'Fetch tracker score'}
                </button>
                {#if signup.riot_tag}
                  <span class="text-[11px]" style="color: rgba(255,255,255,0.64);">
                    {signup.display_name}#{signup.riot_tag}
                  </span>
                {:else}
                  <span class="text-[11px]" style="color: #fcd34d;">
                    No tagline on this signup — ask the player to resubmit.
                  </span>
                {/if}
              </div>

              <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                  Current Rank (C)
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
                  Peak Rank (P)
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
                <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                  Tracker Current (Tc)
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={state.trackerCurrentScore}
                    class="admin-input mt-1"
                    placeholder="Blank = 0"
                    oninput={(e) =>
                      onEditChange(signup.id, {
                        trackerCurrentScore: (e.currentTarget as HTMLInputElement).value,
                      })}
                  />
                </label>
                <label class="text-xs" style="color: rgba(255,255,255,0.82);">
                  Tracker Peak (Tp)
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={state.trackerPeakScore}
                    class="admin-input mt-1"
                    placeholder="Blank = 0"
                    oninput={(e) =>
                      onEditChange(signup.id, {
                        trackerPeakScore: (e.currentTarget as HTMLInputElement).value,
                      })}
                  />
                </label>
              </div>

              <!-- Formula readout -->
              <div
                class="mt-3 rounded-md p-3"
                style="background: rgba(120,67,145,0.08); border: 1px solid rgba(120,67,145,0.28);"
              >
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                  <span
                    class="text-[10px] font-bold tracking-wide uppercase"
                    style="color: rgba(255,255,255,0.5);"
                  >
                    Formula result
                  </span>
                  <span
                    class="text-xl font-bold"
                    style="color: #d8b4fe; font-variant-numeric: tabular-nums;"
                  >
                    {roundRating(preview.rating)}
                  </span>
                </div>
                <div
                  class="mt-1 flex flex-wrap gap-3 text-[11px]"
                  style="color: rgba(255,255,255,0.64); font-variant-numeric: tabular-nums;"
                >
                  <span>0.575C = {preview.currentTerm.toFixed(2)}</span>
                  <span>0.425P = {preview.peakTerm.toFixed(2)}</span>
                  <span>0.15√Tc = {preview.trackerCurrentTerm.toFixed(2)}</span>
                  <span>0.075·ln(Tp) = {preview.trackerPeakTerm.toFixed(2)}</span>
                  <span>× {preview.multiplier.toFixed(3)}</span>
                </div>

                <label class="mt-3 block text-xs" style="color: rgba(255,255,255,0.82);">
                  Manual override
                  <input
                    type="number"
                    step="any"
                    value={state.manualValueOverride}
                    class="admin-input mt-1 md:max-w-[12rem]"
                    placeholder="Leave blank to use the formula"
                    oninput={(e) =>
                      onEditChange(signup.id, {
                        manualValueOverride: (e.currentTarget as HTMLInputElement).value,
                      })}
                  />
                  <span class="mt-1 block text-[11px]" style="color: rgba(255,255,255,0.6);">
                    Overrides the formula for the team calculator.
                  </span>
                </label>
              </div>

              <label class="mt-2 block text-xs" style="color: rgba(255,255,255,0.82);">
                Admin Notes
                <textarea
                  rows="2"
                  value={state.adminNotes}
                  class="admin-input mt-1 leading-5"
                  placeholder="Visible to the player on their signup page."
                  oninput={(e) =>
                    onEditChange(signup.id, {
                      adminNotes: (e.currentTarget as HTMLTextAreaElement).value,
                    })}
                ></textarea>
              </label>

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
