<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { CalendarDays, Link2, RadioTower, Swords } from 'lucide-svelte'
  import {
    DEFAULT_MAP_POOL,
    getDeciderMap,
    getPickedMaps,
    getRemainingMaps,
    normalizeMapPool,
  } from '$lib/matches/veto'

  let { data } = $props()

  const match = $derived(data.match)
  const viewer = $derived(data.viewer)

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }

  function formatUtc(value: string | null | undefined) {
    if (!value) return 'Date TBD'
    const date = new Date(value)
    return `${date.toLocaleString(undefined, { timeZone: 'UTC' })} UTC`
  }

  const mapPool = $derived(normalizeMapPool(match?.metadata?.map_pool ?? DEFAULT_MAP_POOL))
  const actions = $derived((match?.vetoActions ?? []) as any[])
  const remainingMaps = $derived(getRemainingMaps(mapPool, actions as any))
  const pickedMaps = $derived(getPickedMaps(actions as any))
  const deciderMap = $derived(getDeciderMap(mapPool, actions as any))

  const canManage = $derived(Boolean(viewer?.isAdmin || viewer?.isCaptainLike))

  let pendingResultReport = $state<any | null>(null)
  $effect(() => {
    pendingResultReport = match?.pendingResultReport ?? null
  })

  let reportTeamAScore = $state('0')
  let reportTeamBScore = $state('0')
  let reportWinnerTeamId = $state('')
  let reportNotes = $state('')
  let reportEvidenceUrl = $state('')
  let reportError = $state<string | null>(null)
  let reportSuccess = $state<string | null>(null)
  let isReporting = $state(false)

  $effect(() => {
    if (!reportWinnerTeamId && match?.team_a_id) {
      reportWinnerTeamId = match.team_a_id
    }
  })

  async function submitResultReport() {
    reportError = null
    reportSuccess = null
    isReporting = true
    try {
      const res = await fetch(`/api/matches/${match.id}/result-report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          teamAScore: Number(reportTeamAScore),
          teamBScore: Number(reportTeamBScore),
          winnerTeamId: reportWinnerTeamId,
          notes: reportNotes,
          evidenceUrl: reportEvidenceUrl,
        }),
      })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.message ?? 'Failed to report result')

      pendingResultReport = body.report
      reportSuccess = 'Result submitted for admin review.'
    } catch (err: any) {
      reportError = err?.message ?? 'Something went wrong'
    } finally {
      isReporting = false
    }
  }

  function winnerLabel(teamId: string | null | undefined) {
    if (!teamId) return 'Team'
    if (teamId === match.team_a_id) return teamName(match.team_a)
    if (teamId === match.team_b_id) return teamName(match.team_b)
    return 'Team'
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl">
      <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <Swords size={36} style="color: var(--text);" />
          <div>
            <h1 class="responsive-title">{teamName(match.team_a)} vs {teamName(match.team_b)}</h1>
            <p class="text-sm" style="color: rgba(255,255,255,0.72);">
              BO{match.best_of} • {formatUtc(match.scheduled_at)}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span
            class="rounded-full px-2 py-1 text-xs font-bold"
            style="background: rgba(255,255,255,0.12); color: var(--text);"
          >
            {match.status}
          </span>
          {#if match.status === 'completed'}
            <span
              class="rounded-full px-2 py-1 text-xs font-bold"
              style="background: rgba(34,197,94,0.18); color: #86efac;"
            >
              Final {match.team_a_score}-{match.team_b_score}
            </span>
          {/if}
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section
          class="rounded-md border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="mb-3 flex items-center gap-2">
            <CalendarDays size={18} />
            <h2
              class="text-sm font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.8);"
            >
              Details
            </h2>
          </div>

          <div class="space-y-2 text-sm" style="color: rgba(255,255,255,0.78);">
            <div>
              <span style="color: rgba(255,255,255,0.55);">Scheduled:</span>
              <span class="ml-2" style="color: var(--text);">{formatUtc(match.scheduled_at)}</span>
            </div>
            {#if match.started_at}
              <div>
                <span style="color: rgba(255,255,255,0.55);">Started:</span>
                <span class="ml-2" style="color: var(--text);">{formatUtc(match.started_at)}</span>
              </div>
            {/if}
            {#if match.ended_at}
              <div>
                <span style="color: rgba(255,255,255,0.55);">Ended:</span>
                <span class="ml-2" style="color: var(--text);">{formatUtc(match.ended_at)}</span>
              </div>
            {/if}
          </div>

          {#if canManage}
            <div
              class="mt-4 rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.12); background: rgba(255,255,255,0.03);"
            >
              <div class="mb-2 flex items-center gap-2">
                <Link2 size={16} />
                <div
                  class="text-xs font-semibold tracking-wide uppercase"
                  style="color: rgba(255,255,255,0.72);"
                >
                  Captain Tools
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <a
                  href={`/matches/${match.id}/streams`}
                  class="rounded px-2 py-1 text-xs"
                  style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                >
                  Manage Streams
                </a>
                <a
                  href={`/matches/${match.id}/veto`}
                  class="rounded px-2 py-1 text-xs"
                  style="background: rgba(234,179,8,0.18); color: #fde68a;"
                >
                  Map Veto
                </a>
              </div>
            </div>
          {/if}

          {#if canManage && match.status !== 'completed' && match.status !== 'cancelled'}
            <div
              class="mt-4 rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18);"
            >
              <div
                class="mb-2 text-xs font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.72);"
              >
                Report Result
              </div>

              {#if pendingResultReport}
                <div
                  class="rounded-md border p-3 text-sm"
                  style="border-color: rgba(234,179,8,0.35); background: rgba(234,179,8,0.10); color: #fde68a;"
                >
                  Pending admin review: {pendingResultReport.team_a_score}-{pendingResultReport.team_b_score}
                  (Winner {winnerLabel(pendingResultReport.winner_team_id)})
                </div>
              {:else}
                {#if reportError}
                  <div
                    class="mb-3 rounded-md border p-3 text-sm"
                    style="border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); color: #fecaca;"
                  >
                    {reportError}
                  </div>
                {/if}
                {#if reportSuccess}
                  <div
                    class="mb-3 rounded-md border p-3 text-sm"
                    style="border-color: rgba(34,197,94,0.30); background: rgba(34,197,94,0.08); color: #86efac;"
                  >
                    {reportSuccess}
                  </div>
                {/if}

                <div class="grid grid-cols-1 gap-2 md:grid-cols-4">
                  <input
                    type="number"
                    min="0"
                    bind:value={reportTeamAScore}
                    class="rounded-md border px-2 py-1 text-sm"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                    placeholder={`${teamName(match.team_a)} score`}
                  />
                  <input
                    type="number"
                    min="0"
                    bind:value={reportTeamBScore}
                    class="rounded-md border px-2 py-1 text-sm"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                    placeholder={`${teamName(match.team_b)} score`}
                  />
                  <select
                    bind:value={reportWinnerTeamId}
                    class="rounded-md border px-2 py-1 text-sm"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                  >
                    <option value={match.team_a_id}>{teamName(match.team_a)}</option>
                    <option value={match.team_b_id}>{teamName(match.team_b)}</option>
                  </select>
                  <button
                    type="button"
                    class="rounded px-2 py-1 text-xs font-semibold"
                    style="background: rgba(234,179,8,0.18); color: #fde68a;"
                    onclick={submitResultReport}
                    disabled={isReporting}
                  >
                    {isReporting ? 'Submitting...' : 'Submit'}
                  </button>
                </div>

                <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <input
                    type="url"
                    bind:value={reportEvidenceUrl}
                    class="rounded-md border px-2 py-1 text-sm"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                    placeholder="Evidence URL (optional)"
                  />
                  <input
                    type="text"
                    bind:value={reportNotes}
                    class="rounded-md border px-2 py-1 text-sm"
                    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                    placeholder="Notes (optional)"
                  />
                </div>
              {/if}
            </div>
          {/if}
        </section>

        <section
          class="rounded-md border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="mb-3 flex items-center gap-2">
            <RadioTower size={18} />
            <h2
              class="text-sm font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.8);"
            >
              Streams
            </h2>
          </div>

          {#if (match.streams ?? []).length === 0}
            <p class="text-sm" style="color: rgba(255,255,255,0.72);">No streams listed yet.</p>
          {:else}
            <div class="flex flex-col gap-2">
              {#each match.streams as stream}
                <a
                  href={stream.stream_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="rounded-md border p-3 text-sm"
                  style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18); color: var(--text);"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div>
                      <strong>{stream.platform}</strong>
                      {#if stream.is_primary}
                        <span
                          class="ml-2 rounded-full px-2 py-0.5 text-xs"
                          style="background: rgba(59,130,246,0.2); color: #93c5fd;">Primary</span
                        >
                      {/if}
                    </div>
                    <span
                      class="rounded-full px-2 py-0.5 text-xs"
                      style="background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.8);"
                      >{stream.status}</span
                    >
                  </div>
                  <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.65);">
                    {stream.stream_url}
                  </div>
                </a>
              {/each}
            </div>
          {/if}
        </section>
      </div>

      <section
        class="mt-4 rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div class="mb-3 flex items-center gap-2">
          <h2
            class="text-sm font-semibold tracking-wide uppercase"
            style="color: rgba(255,255,255,0.8);"
          >
            Map Veto
          </h2>
        </div>

        {#if actions.length === 0}
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">No veto actions yet.</p>
        {:else}
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18);"
            >
              <div
                class="text-xs font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.72);"
              >
                Timeline
              </div>
              <div class="mt-2 flex flex-col gap-2">
                {#each actions as action}
                  <div
                    class="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs"
                    style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.04);"
                  >
                    <div style="color: var(--text);">
                      <span
                        class="rounded-full px-2 py-0.5"
                        style="background: rgba(255,255,255,0.10);">#{action.action_order}</span
                      >
                      <span class="ml-2 font-semibold" style="color: rgba(255,255,255,0.85);"
                        >{action.action_type.toUpperCase()}</span
                      >
                      <span class="ml-2">{action.map_name}</span>
                    </div>
                  </div>
                {/each}
              </div>
            </div>

            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18);"
            >
              <div
                class="text-xs font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.72);"
              >
                Resolved
              </div>

              <div class="mt-2 text-sm" style="color: rgba(255,255,255,0.78);">
                <div>
                  <span style="color: rgba(255,255,255,0.55);">Picks:</span>
                  <span class="ml-2" style="color: var(--text);">
                    {pickedMaps.length > 0 ? pickedMaps.join(', ') : 'None'}
                  </span>
                </div>
                <div class="mt-1">
                  <span style="color: rgba(255,255,255,0.55);">Decider:</span>
                  <span class="ml-2" style="color: var(--text);">{deciderMap ?? 'TBD'}</span>
                </div>
                <div class="mt-2">
                  <span style="color: rgba(255,255,255,0.55);">Remaining:</span>
                  <span class="ml-2" style="color: rgba(255,255,255,0.8);"
                    >{remainingMaps.join(', ')}</span
                  >
                </div>
              </div>
            </div>
          </div>
        {/if}
      </section>
    </div>
  </div>
</PageContainer>
