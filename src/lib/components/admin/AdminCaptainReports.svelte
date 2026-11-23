<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { ClipboardList, Loader2, ExternalLink } from 'lucide-svelte'

  type PreviewMap = { matchId: string; mapName: string | null; score: string; isForfeit: boolean }
  type Report = {
    id: string
    matchId: string
    status: 'applied' | 'pending' | 'rejected'
    trackerInput: string
    vetoLines: string[]
    forfeitMap: { winnerTeamId: string; order: number; label: string | null } | null
    note: string | null
    reviewReasons: string[]
    preview: {
      teamA: { id: string; name: string }
      teamB: { id: string; name: string }
      unmatchedPlayers: string[]
      maps: PreviewMap[]
    } | null
    reviewNote: string | null
    reviewedAt: string | null
    createdAt: string
    teamName: string | null
    submitterName: string | null
    matchLabel: string
    matchScheduledAt: string | null
  }

  let { reports = [] }: { reports?: Report[] } = $props()

  const pending = $derived(reports.filter((r) => r.status === 'pending'))
  const recent = $derived(reports.filter((r) => r.status !== 'pending'))

  let showRecent = $state(false)
  let busyId = $state<string | null>(null)
  let errorById = $state<Record<string, string>>({})
  let noteById = $state<Record<string, string>>({})

  async function review(report: Report, action: 'approve' | 'reject') {
    busyId = report.id
    errorById = { ...errorById, [report.id]: '' }
    try {
      const res = await fetch(`/api/admin/match-reports/${report.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, note: noteById[report.id] ?? '' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        errorById = { ...errorById, [report.id]: body?.message ?? `Failed (${res.status}).` }
        return
      }
      await invalidateAll()
    } finally {
      busyId = null
    }
  }

  function forfeitWinner(report: Report) {
    const id = report.forfeitMap?.winnerTeamId
    if (!id || !report.preview) return 'Unknown team'
    return report.preview.teamA.id === id ? report.preview.teamA.name : report.preview.teamB.name
  }

  function when(value: string | null) {
    if (!value) return '—'
    return new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }
</script>

{#if reports.length > 0}
  <section class="admin-card admin-card-pad">
    <div class="head">
      <ClipboardList size={16} />
      <h2 class="admin-section-title">Captain submissions</h2>
      {#if pending.length > 0}
        <span class="admin-pill pill-pending">{pending.length} waiting</span>
      {/if}
      {#if recent.length > 0}
        <button
          type="button"
          class="admin-btn admin-btn-neutral admin-btn-sm toggle"
          onclick={() => (showRecent = !showRecent)}
        >
          {showRecent ? 'Hide' : 'Show'} recent
        </button>
      {/if}
    </div>

    {#if pending.length === 0}
      <p class="admin-hint mt-2">Nothing is waiting on review.</p>
    {/if}

    <div class="list">
      {#each pending as report (report.id)}
        <article class="admin-subcard item">
          <div class="item-head">
            <a href={resolve(`/matches/${report.matchId}`)} class="match-link">
              {report.matchLabel}
              <ExternalLink size={12} />
            </a>
            <span class="admin-hint">
              {when(report.matchScheduledAt)} · from {report.submitterName ??
                'unknown'}{report.teamName ? ` (${report.teamName})` : ''} · {when(
                report.createdAt
              )}
            </span>
          </div>

          <ul class="reasons">
            {#each report.reviewReasons as reason (reason)}
              <li>{reason}</li>
            {/each}
          </ul>

          {#if report.note}
            <p class="note"><b>Captain's note:</b> {report.note}</p>
          {/if}

          {#if report.preview}
            <ul class="maps">
              {#each report.preview.maps as map, i (map.matchId)}
                <li>
                  <span class="admin-hint">Map {i + 1}</span>
                  <span>{map.isForfeit ? 'Forfeit' : (map.mapName ?? 'Unknown map')}</span>
                  <span class="score">{map.score}</span>
                </li>
              {/each}
            </ul>
            <p class="admin-hint">
              Scores read {report.preview.teamA.name} – {report.preview.teamB.name}.
              {#if report.forfeitMap}
                Forfeited map {report.forfeitMap.order} won by {forfeitWinner(report)}{report
                  .forfeitMap.label
                  ? ` (${report.forfeitMap.label})`
                  : ''}.
              {/if}
              {#if report.preview.unmatchedPlayers.length > 0}
                Not on either roster: {report.preview.unmatchedPlayers.join(', ')}.
              {/if}
            </p>
          {/if}

          <details class="raw">
            <summary class="admin-hint">Submitted links and veto</summary>
            <pre>{report.trackerInput}</pre>
            {#if report.vetoLines.length > 0}
              <pre>{report.vetoLines.join('\n')}</pre>
            {/if}
          </details>

          {#if errorById[report.id]}
            <div class="admin-alert admin-alert-error">{errorById[report.id]}</div>
          {/if}

          <div class="actions">
            <input
              class="admin-input note-input"
              placeholder="Note to the captain (optional)"
              value={noteById[report.id] ?? ''}
              oninput={(e) =>
                (noteById = {
                  ...noteById,
                  [report.id]: (e.currentTarget as HTMLInputElement).value,
                })}
              disabled={busyId !== null}
            />
            <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved path plus a query string -->
            <a
              class="admin-btn admin-btn-neutral admin-btn-sm"
              href={`${resolve('/admin/matches-import')}?match=${report.matchId}`}
              title="Import by hand instead, e.g. with different links"
            >
              Open in importer
            </a>
            <button
              type="button"
              class="admin-btn admin-btn-danger admin-btn-sm"
              disabled={busyId !== null}
              onclick={() => review(report, 'reject')}
            >
              Reject
            </button>
            <button
              type="button"
              class="admin-btn admin-btn-go admin-btn-sm"
              disabled={busyId !== null}
              onclick={() => review(report, 'approve')}
            >
              {#if busyId === report.id}<Loader2 size={14} class="animate-spin" />{/if}
              Approve &amp; import
            </button>
          </div>
        </article>
      {/each}

      {#if showRecent}
        {#each recent as report (report.id)}
          <div class="admin-row">
            <a href={resolve(`/matches/${report.matchId}`)} class="match-link">
              {report.matchLabel}
            </a>
            <span class="admin-hint">
              {report.submitterName ?? 'unknown'} · {when(report.createdAt)}
              {#if report.reviewNote}· “{report.reviewNote}”{/if}
            </span>
            <span
              class="admin-pill"
              class:pill-applied={report.status === 'applied'}
              class:pill-rejected={report.status === 'rejected'}
            >
              {report.status === 'applied'
                ? report.reviewedAt
                  ? 'Approved'
                  : 'Auto-applied'
                : 'Rejected'}
            </span>
          </div>
        {/each}
      {/if}
    </div>
  </section>
{/if}

<style src="./AdminCaptainReports.css"></style>
