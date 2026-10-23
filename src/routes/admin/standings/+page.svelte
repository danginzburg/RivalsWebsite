<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { ArrowLeft, Loader2, RefreshCw, Pencil, X } from 'lucide-svelte'
  import { resolve } from '$app/paths'
  import { goto, invalidateAll } from '$app/navigation'

  let { data }: PageProps = $props()

  type Row = NonNullable<typeof data.standings>['rows'][number]

  const seasonOptions = $derived(
    (data.seasons ?? []).map((season) => ({
      value: season.id,
      label: season.is_active ? `${season.name} (Active)` : season.name,
    }))
  )

  let isRecalculating = $state(false)
  let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null)

  /** The team whose correction is open, and the form's draft values. */
  let editingTeamId = $state<string | null>(null)
  let draft = $state({
    wins: 0,
    losses: 0,
    map_wins: 0,
    map_losses: 0,
    round_diff: 0,
    /** The team's final points total, not a delta; see pointsDelta. */
    points: 0,
    rank_override: '' as string | number,
    note: '',
  })
  /** The total and stored bonus the editor opened with. */
  let pointsBase = $state({ total: 0, bonus: 0 })
  let isSaving = $state(false)

  /**
   * Visible width of the table's scroll box. On a phone the table is wider
   * than the screen, so the correction form is pinned to this width (and
   * sticky left) instead of stretching across the full scrolled table.
   */
  let tableViewWidth = $state(0)

  const ADJUST_FIELDS = [
    { id: 'wins', label: 'Series W' },
    { id: 'losses', label: 'Series L' },
    { id: 'map_wins', label: 'Map W' },
    { id: 'map_losses', label: 'Map L' },
    { id: 'round_diff', label: 'Round Diff' },
  ] as const

  function signed(n: number) {
    return n > 0 ? `+${n}` : String(n)
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleString()
  }

  function openEditor(row: Row) {
    message = null
    editingTeamId = row.team_id
    const adj = row.adjustment
    draft = {
      wins: adj?.wins ?? 0,
      losses: adj?.losses ?? 0,
      map_wins: adj?.map_wins ?? 0,
      map_losses: adj?.map_losses ?? 0,
      round_diff: adj?.round_diff ?? 0,
      points: row.points,
      rank_override: adj?.rank_override ?? '',
      note: adj?.note ?? '',
    }
    pointsBase = { total: row.points, bonus: adj?.points ?? 0 }
  }

  /**
   * The stored points correction is a delta on top of the calculated points
   * (and, in point-scoring seasons, 3 per adjusted series win), so it survives
   * the next import. Left untouched, the existing bonus is kept and adjusted
   * wins still move the total; otherwise the delta lands exactly on the total.
   */
  function pointsDelta(row: Row) {
    const total = Number(draft.points)
    if (draft.points === null || !Number.isFinite(total) || total === pointsBase.total) {
      return pointsBase.bonus
    }
    const winPoints = data.standings?.awardPoints ? Number(draft.wins || 0) * 3 : 0
    return total - row.auto.points - winPoints
  }

  async function send(method: 'POST' | 'PUT', body: Record<string, unknown>) {
    const response = await window.fetch('/api/admin/leaderboard/standings', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: data.seasonId, ...body }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.message ?? 'Request failed')
    await invalidateAll()
  }

  async function recalculate() {
    isRecalculating = true
    message = null
    try {
      await send('POST', {})
      message = { kind: 'ok', text: 'Standings recalculated and published.' }
    } catch (err) {
      message = { kind: 'error', text: err instanceof Error ? err.message : 'Recalculate failed' }
    } finally {
      isRecalculating = false
    }
  }

  async function saveCorrection(teamId: string, values: typeof draft) {
    isSaving = true
    message = null
    try {
      await send('PUT', { teamId, ...values })
      editingTeamId = null
      message = { kind: 'ok', text: 'Correction saved and standings republished.' }
    } catch (err) {
      message = { kind: 'error', text: err instanceof Error ? err.message : 'Save failed' }
    } finally {
      isSaving = false
    }
  }

  function clearCorrection(teamId: string) {
    return saveCorrection(teamId, {
      wins: 0,
      losses: 0,
      map_wins: 0,
      map_losses: 0,
      round_diff: 0,
      points: 0,
      rank_override: '',
      note: '',
    })
  }
</script>

<PageContainer>
  <div class="flex justify-center py-6 sm:py-8">
    <div class="w-full max-w-6xl space-y-5">
      <header class="admin-import-head">
        <div class="min-w-0">
          <h1 class="admin-import-title">Standings</h1>
          <p class="admin-hint mt-1">
            Calculated from the season's completed regular-season matches and published to the
            leaderboard. External tournaments award 3 points per series win (nothing for a loss);
            Rivals seasons rank on series record. Ties fall to map diff, round diff, then map wins.
            Disbanded teams are not ranked. Every match import or result edit recalculates the
            active season automatically. Corrections and CSV imports are fallbacks: corrections are
            added on top of the calculation, and a CSV import only shows when there are no matches
            to calculate from. Corrections survive future match imports.
          </p>
        </div>
        <div class="flex flex-shrink-0 items-center gap-2">
          <a href={resolve('/admin/leaderboard-import')} class="admin-back-link">CSV import</a>
          <a href={resolve('/admin')} class="admin-back-link">
            <ArrowLeft size={14} /> Admin
          </a>
        </div>
      </header>

      <section class="admin-card admin-card-pad">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div class="w-full sm:max-w-xs">
            <div class="admin-field-label">Season</div>
            <CustomSelect
              options={seasonOptions}
              value={data.seasonId ?? ''}
              onSelect={(value) => {
                editingTeamId = null
                message = null
                // The path is resolved; only the query string is appended.
                // eslint-disable-next-line svelte/no-navigation-without-resolve
                goto(`${resolve('/admin/standings')}?season=${encodeURIComponent(value)}`)
              }}
            />
          </div>
          <button
            type="button"
            class="admin-btn admin-btn-info flex-shrink-0"
            onclick={recalculate}
            disabled={isRecalculating || !data.seasonId}
          >
            <span class="inline-flex items-center gap-2">
              {#if isRecalculating}
                <Loader2 size={16} class="animate-spin" /> Publishing...
              {:else}
                <RefreshCw size={16} /> Recalculate &amp; publish
              {/if}
            </span>
          </button>
        </div>

        {#if data.standings}
          <div class="admin-hint mt-3">
            {data.standings.matchCount} completed match{data.standings.matchCount === 1 ? '' : 'es'}
            counted (playoffs, play-ins and kickoff are not).
            {#if data.standings.outOfGroupCount > 0}
              {data.standings.outOfGroupCount} out-of-group game{data.standings.outOfGroupCount ===
              1
                ? ''
                : 's'} left out; add their points with a correction.
            {/if}
            {data.standings.awardPoints
              ? 'Points are awarded (external tournament).'
              : 'No points (Rivals season).'}
            {#if data.standings.disbandedTeams.length > 0}
              Not ranked (disbanded): {data.standings.disbandedTeams.map((t) => t.name).join(', ')}.
            {/if}
            {#if data.publishedSource?.computed}
              Public standings were last calculated {formatTime(data.publishedSource.at)}.
            {/if}
          </div>
          {#if data.publishedSource && !data.publishedSource.computed}
            <div class="admin-alert admin-alert-warn mt-3">
              The public leaderboard is showing a CSV import ({data.publishedSource.label ??
                'unnamed'}, {formatTime(data.publishedSource.at)}) because no calculated standings
              with matches are published. Recalculate &amp; publish to replace it with the table
              below.
            </div>
          {:else if !data.publishedSource}
            <div class="admin-alert admin-alert-warn mt-3">
              Nothing is published for this season yet. Recalculate &amp; publish to put these
              standings on the leaderboard.
            </div>
          {/if}
        {/if}

        {#if message}
          <div
            class={`admin-alert mt-3 ${message.kind === 'error' ? 'admin-alert-error' : 'admin-alert-success'}`}
          >
            {message.text}
          </div>
        {/if}
      </section>

      {#if data.standings}
        <section class="admin-card admin-card-pad">
          {#if data.standings.rows.length === 0}
            <div class="admin-note">This season has no approved teams.</div>
          {:else}
            <div class="table-scroll" bind:clientWidth={tableViewWidth}>
              <table class="min-w-full text-left text-sm">
                <thead>
                  <tr class="text-xs uppercase" style="color: rgba(255,255,255,0.75);">
                    <th class="px-3 py-2">Rank</th>
                    <th class="px-3 py-2">Team</th>
                    {#if data.standings.awardPoints}<th class="px-3 py-2">Points</th>{/if}
                    <th class="px-3 py-2">Series</th>
                    <th class="px-3 py-2">Maps</th>
                    <th class="px-3 py-2">Round Diff</th>
                    <th class="px-3 py-2">Correction</th>
                    <th class="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {#each data.standings.rows as row (row.team_id)}
                    <tr class="admin-divide border-t">
                      <td class="px-3 py-2">
                        {row.rank}{#if row.adjustment?.rank_override}<span
                            class="pin"
                            title="Pinned rank">pinned</span
                          >{/if}
                      </td>
                      <td class="px-3 py-2 font-semibold" style="color: var(--text);">
                        {row.team_name}
                        {#if row.team_tag}<span class="tag">{row.team_tag}</span>{/if}
                      </td>
                      {#if data.standings.awardPoints}
                        <td class="px-3 py-2">
                          {row.points}
                          {#if row.points !== row.auto.points}<span class="auto"
                              >auto {row.auto.points}</span
                            >{/if}
                        </td>
                      {/if}
                      <td class="px-3 py-2">
                        {row.wins}-{row.losses}
                        {#if row.wins !== row.auto.wins || row.losses !== row.auto.losses}<span
                            class="auto">auto {row.auto.wins}-{row.auto.losses}</span
                          >{/if}
                      </td>
                      <td class="px-3 py-2">
                        {row.map_wins}-{row.map_losses}
                        {#if row.map_wins !== row.auto.map_wins || row.map_losses !== row.auto.map_losses}<span
                            class="auto">auto {row.auto.map_wins}-{row.auto.map_losses}</span
                          >{/if}
                      </td>
                      <td class="px-3 py-2">
                        {signed(row.round_diff)}
                        {#if row.round_diff !== row.auto.round_diff}<span class="auto"
                            >auto {signed(row.auto.round_diff)}</span
                          >{/if}
                      </td>
                      <td class="px-3 py-2 text-xs" style="color: rgba(255,255,255,0.72);">
                        {#if row.adjustment}
                          {row.adjustment.note ?? 'Adjusted'}
                        {:else}
                          —
                        {/if}
                      </td>
                      <td class="px-3 py-2 text-right">
                        {#if editingTeamId === row.team_id}
                          <button
                            type="button"
                            class="admin-btn admin-btn-neutral"
                            onclick={() => (editingTeamId = null)}
                            aria-label="Close correction"><X size={14} /></button
                          >
                        {:else}
                          <button
                            type="button"
                            class="admin-btn admin-btn-neutral"
                            onclick={() => openEditor(row)}
                          >
                            <span class="inline-flex items-center gap-1"
                              ><Pencil size={14} /> Correct</span
                            >
                          </button>
                        {/if}
                      </td>
                    </tr>
                    {#if editingTeamId === row.team_id}
                      <tr>
                        <td colspan="8" class="px-3 pb-4">
                          <div
                            class="editor"
                            style:width={tableViewWidth ? `${tableViewWidth - 24}px` : undefined}
                          >
                            <div class="admin-hint mb-2">
                              Amounts are added to the calculated numbers (use negatives to take
                              away), except Points, which is the final total.{#if data.standings.awardPoints}
                                Each series win adjusted here is worth 3 points unless you change
                                Points yourself.{/if}
                            </div>
                            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                              {#each ADJUST_FIELDS as field (field.id)}
                                <label class="block">
                                  <div class="admin-field-label">{field.label}</div>
                                  <input
                                    type="number"
                                    step="1"
                                    class="admin-input"
                                    bind:value={draft[field.id]}
                                  />
                                </label>
                              {/each}
                              <label class="block">
                                <div class="admin-field-label">Points</div>
                                <input
                                  type="number"
                                  step="1"
                                  class="admin-input"
                                  title="Final points total (auto {row.auto.points})"
                                  bind:value={draft.points}
                                />
                              </label>
                              <label class="block">
                                <div class="admin-field-label">Pin Rank</div>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  class="admin-input"
                                  placeholder="Auto"
                                  bind:value={draft.rank_override}
                                />
                              </label>
                            </div>
                            <label class="mt-3 block">
                              <div class="admin-field-label">Note</div>
                              <input
                                class="admin-input"
                                placeholder="e.g. Forfeit win vs XYZ not imported"
                                bind:value={draft.note}
                              />
                            </label>
                            <div class="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                class="admin-btn admin-btn-info"
                                disabled={isSaving}
                                onclick={() =>
                                  saveCorrection(row.team_id, {
                                    ...draft,
                                    points: pointsDelta(row),
                                  })}
                              >
                                {isSaving ? 'Saving...' : 'Save correction'}
                              </button>
                              {#if row.adjustment}
                                <button
                                  type="button"
                                  class="admin-btn admin-btn-danger"
                                  disabled={isSaving}
                                  onclick={() => clearCorrection(row.team_id)}
                                >
                                  Clear correction
                                </button>
                              {/if}
                            </div>
                          </div>
                        </td>
                      </tr>
                    {/if}
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </section>
      {/if}
    </div>
  </div>
</PageContainer>

<style>
  .auto {
    margin-left: 0.4rem;
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.5);
  }
  .tag {
    margin-left: 0.4rem;
    font-size: 0.7rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.55);
  }
  .pin {
    margin-left: 0.35rem;
    font-size: 0.65rem;
    text-transform: uppercase;
    color: #fcd34d;
  }
  .editor {
    position: sticky;
    left: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.5rem;
    padding: 0.85rem;
    background: rgba(255, 255, 255, 0.03);
  }
</style>
