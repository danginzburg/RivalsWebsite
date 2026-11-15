<script lang="ts">
  import { untrack } from 'svelte'
  import { invalidateAll } from '$app/navigation'
  import { ClipboardList, ChevronDown, Loader2 } from 'lucide-svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { normalizeVetoLines } from '$lib/matches/vetoLog'

  type Team = { id: string; name: string }
  type ReportState = {
    latest: {
      id: string
      status: 'applied' | 'pending' | 'rejected'
      reviewReasons: string[]
      reviewNote: string | null
      createdAt: string
      byOwnTeam: boolean
    } | null
  }
  type PreviewMap = {
    matchId: string
    mapName: string | null
    score: string
    playerCount: number
    isForfeit: boolean
  }
  type Preview = {
    teamA: { name: string }
    teamB: { name: string }
    unmatchedPlayers: string[]
    maps: PreviewMap[]
  }

  let {
    matchId,
    teamA,
    teamB,
    hasStats,
    report,
  }: {
    matchId: string
    teamA: Team
    teamB: Team
    hasStats: boolean
    report: ReportState
  } = $props()

  // Open by default while the match is still waiting on results. Only the
  // first render decides; after that it is the captain's toggle.
  let expanded = $state(untrack(() => !hasStats && !report.latest))

  let veto = $state('')
  let links = $state('')
  let ffEnabled = $state(false)
  let ffWinnerTeamId = $state('')
  let ffOrder = $state('1')
  let ffLabel = $state('')
  let note = $state('')

  let busy = $state<'preview' | 'submit' | null>(null)
  let errorMessage = $state<string | null>(null)
  let successMessage = $state<string | null>(null)
  let checked = $state<{
    preview: Preview | null
    reviewReasons: string[]
    willApply: boolean
  } | null>(null)

  const vetoPreview = $derived(veto.trim() ? normalizeVetoLines(veto.split(/\r?\n/)) : [])
  const hasLinks = $derived(links.trim().length > 0)
  const canSend = $derived(
    busy === null && (hasLinks || vetoPreview.length > 0) && (!ffEnabled || !!ffWinnerTeamId)
  )
  const teamOptions = $derived([
    { value: teamA.id, label: teamA.name },
    { value: teamB.id, label: teamB.name },
  ])
  const orderOptions = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `Map ${n}` }))

  // Any edit invalidates the last check.
  $effect(() => {
    void [veto, links, ffEnabled, ffWinnerTeamId, ffOrder, ffLabel, note]
    checked = null
  })

  function payload(dryRun: boolean) {
    return {
      dryRun,
      veto,
      input: links,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(ffEnabled
        ? {
            forfeitMap: {
              winnerTeamId: ffWinnerTeamId,
              order: Number(ffOrder),
              ...(ffLabel.trim() ? { label: ffLabel.trim() } : {}),
            },
          }
        : {}),
    }
  }

  async function send(dryRun: boolean) {
    busy = dryRun ? 'preview' : 'submit'
    errorMessage = null
    successMessage = null
    try {
      const res = await fetch(`/api/matches/${matchId}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload(dryRun)),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        errorMessage = body?.message ?? `Something went wrong (${res.status}).`
        return
      }
      if (dryRun) {
        checked = {
          preview: body.preview ?? null,
          reviewReasons: body.reviewReasons ?? [],
          willApply: body.willApply ?? false,
        }
        return
      }
      successMessage =
        body.outcome === 'applied'
          ? 'Results imported. Stats and standings are updating.'
          : body.outcome === 'pending'
            ? 'Submitted. An admin will review it before the stats go live.'
            : 'Veto saved.'
      veto = ''
      links = ''
      note = ''
      ffEnabled = false
      ffWinnerTeamId = ''
      ffLabel = ''
      await invalidateAll()
    } finally {
      busy = null
    }
  }

  function formatWhen(value: string) {
    return new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }
</script>

<section class="admin-card admin-card-pad report-panel">
  <button
    type="button"
    class="panel-head"
    aria-expanded={expanded}
    onclick={() => (expanded = !expanded)}
  >
    <ClipboardList size={15} />
    <span class="admin-section-title">Submit match results</span>
    {#if report.latest?.status === 'pending'}
      <span class="admin-pill pill-pending">Awaiting review</span>
    {:else if report.latest?.status === 'applied'}
      <span class="admin-pill pill-applied">Submitted</span>
    {/if}
    <ChevronDown size={16} class="chevron {expanded ? 'chevron-open' : ''}" />
  </button>

  {#if expanded}
    <div class="body">
      {#if report.latest}
        <div
          class="admin-alert"
          class:admin-alert-success={report.latest.status === 'applied'}
          class:admin-alert-warn={report.latest.status === 'pending'}
          class:admin-alert-error={report.latest.status === 'rejected'}
        >
          {#if report.latest.status === 'applied'}
            Results were submitted {report.latest.byOwnTeam ? 'by your team' : 'by the other team'}
            on {formatWhen(report.latest.createdAt)} and applied.
          {:else if report.latest.status === 'pending'}
            A submission from {report.latest.byOwnTeam ? 'your team' : 'the other team'} is waiting for
            an admin.
            {#if report.latest.reviewReasons.length > 0}
              <ul class="reasons">
                {#each report.latest.reviewReasons as reason (reason)}
                  <li>{reason}</li>
                {/each}
              </ul>
            {/if}
          {:else}
            The last submission was rejected{report.latest.reviewNote
              ? `: ${report.latest.reviewNote}`
              : '.'}
          {/if}
        </div>
      {/if}

      <p class="admin-hint">
        Paste the veto bot's log and the tracker.gg link for each map. A normal series goes through
        automatically; a forfeit, a note, or anything that doesn't line up is checked by an admin
        first.
        {#if hasStats}
          This match already has stats, so a new submission will go to an admin.
        {/if}
      </p>

      <div class="fields">
        <label class="admin-label">
          Veto log
          <textarea
            bind:value={veto}
            rows="4"
            class="admin-textarea text-xs"
            placeholder="Paste the veto bot's log as-is"
            disabled={busy !== null}
          ></textarea>
        </label>
        {#if vetoPreview.length > 0}
          <ol class="veto-preview">
            {#each vetoPreview as line, i (i)}
              <li>{line}</li>
            {/each}
          </ol>
        {/if}

        <label class="admin-label">
          Tracker links
          <textarea
            bind:value={links}
            rows="3"
            class="admin-textarea text-xs"
            placeholder="https://tracker.gg/valorant/match/…&#10;https://tracker.gg/valorant/match/…"
            disabled={busy !== null}
          ></textarea>
          <span class="admin-hint">One per map, in the order they were played.</span>
        </label>

        <label class="check">
          <input type="checkbox" bind:checked={ffEnabled} disabled={busy !== null} />
          <span>A map was forfeited</span>
        </label>
        {#if ffEnabled}
          <div class="ff-grid">
            <div>
              <div class="admin-field-label">Won by</div>
              <CustomSelect
                options={teamOptions}
                bind:value={ffWinnerTeamId}
                placeholder="Pick a team"
                disabled={busy !== null}
              />
            </div>
            <div>
              <div class="admin-field-label">Position</div>
              <CustomSelect options={orderOptions} bind:value={ffOrder} disabled={busy !== null} />
            </div>
            <label class="admin-label ff-label">
              What happened (optional)
              <input
                bind:value={ffLabel}
                class="admin-input"
                placeholder="e.g. No-show for map 3"
                disabled={busy !== null}
              />
            </label>
          </div>
        {/if}

        <label class="admin-label">
          Note for admins (optional)
          <input
            bind:value={note}
            class="admin-input"
            maxlength="1000"
            placeholder="Anything an admin should know — adding a note sends this to review"
            disabled={busy !== null}
          />
        </label>
      </div>

      {#if errorMessage}<div class="admin-alert admin-alert-error">{errorMessage}</div>{/if}
      {#if successMessage}<div class="admin-alert admin-alert-success">{successMessage}</div>{/if}

      {#if checked?.preview}
        <div class="admin-subcard preview">
          <div class="preview-head">
            <span>{checked.preview.teamA.name} vs {checked.preview.teamB.name}</span>
            {#if checked.willApply}
              <span class="admin-pill pill-applied">Will apply automatically</span>
            {:else}
              <span class="admin-pill pill-pending">Will go to admin review</span>
            {/if}
          </div>
          <ul class="preview-maps">
            {#each checked.preview.maps as map, i (map.matchId)}
              <li>
                <span class="muted">Map {i + 1}</span>
                <span>{map.mapName ?? 'Unknown map'}</span>
                <span class="score">{map.score}</span>
                {#if !map.isForfeit}<span class="muted">{map.playerCount} players</span>{/if}
              </li>
            {/each}
          </ul>
          {#if checked.reviewReasons.length > 0}
            <ul class="reasons">
              {#each checked.reviewReasons as reason (reason)}
                <li>{reason}</li>
              {/each}
            </ul>
          {/if}
          {#if checked.preview.unmatchedPlayers.length > 0}
            <p class="admin-hint">
              Not on either roster (imported by name): {checked.preview.unmatchedPlayers.join(', ')}
            </p>
          {/if}
        </div>
      {/if}

      <div class="actions">
        {#if hasLinks || ffEnabled}
          <button
            type="button"
            class="admin-btn admin-btn-neutral"
            disabled={!canSend || !hasLinks}
            onclick={() => send(true)}
          >
            {#if busy === 'preview'}<Loader2 size={15} class="animate-spin" /> Checking…{:else}Preview{/if}
          </button>
        {/if}
        <button
          type="button"
          class="admin-btn admin-btn-primary"
          disabled={!canSend}
          onclick={() => send(false)}
        >
          {#if busy === 'submit'}
            <Loader2 size={15} class="animate-spin" /> Submitting…
          {:else if hasLinks || ffEnabled}
            Submit results
          {:else}
            Save veto
          {/if}
        </button>
      </div>
    </div>
  {/if}
</section>

<style>
  .report-panel {
    margin-top: 0.75rem;
  }
  .panel-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    color: var(--admin-label);
  }
  .panel-head :global(.chevron) {
    margin-left: auto;
    transition: transform 0.15s ease;
  }
  .panel-head :global(.chevron-open) {
    transform: rotate(180deg);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 0.75rem;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .veto-preview {
    margin: -0.25rem 0 0;
    padding-left: 1.25rem;
    list-style: decimal;
    font-size: 0.75rem;
    color: var(--admin-muted);
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--text);
    cursor: pointer;
  }
  .ff-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
  @media (min-width: 640px) {
    .ff-grid {
      grid-template-columns: 1fr 8rem 2fr;
    }
  }
  .preview {
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--text);
  }
  .preview-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-weight: 600;
  }
  .preview-maps {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .preview-maps li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .score {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .muted {
    color: var(--admin-muted);
  }
  .reasons {
    margin: 0.25rem 0 0;
    padding-left: 1.1rem;
    list-style: disc;
    font-size: 0.8125rem;
  }
  .pill-pending {
    background: rgba(234, 179, 8, 0.16);
    color: #fde047;
  }
  .pill-applied {
    background: rgba(74, 222, 128, 0.16);
    color: #86efac;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
