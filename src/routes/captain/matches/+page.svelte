<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { CalendarDays } from 'lucide-svelte'

  let { data } = $props()

  const getInitialCaptainTeams = () => data.captainTeams ?? []
  const getInitialOpponentTeams = () => data.opponentTeams ?? []
  const getInitialProposals = () => data.proposals ?? []
  const captainTeamIds = $derived(data.captainTeamIds ?? [])

  let captainTeams = $state(getInitialCaptainTeams())
  let opponentTeams = $state(getInitialOpponentTeams())
  let proposals = $state(getInitialProposals())

  let proposedByTeamId = $state(captainTeams[0]?.id ?? '')
  let opponentTeamId = $state('')
  let proposedDate = $state('')
  let proposedTime = $state('')
  const bestOf = 3
  let notes = $state('')
  let message = $state<{ type: 'success' | 'error'; text: string } | null>(null)
  let isSubmitting = $state(false)

  function utcIsoFromDateTime(date: string, time: string): string {
    const [yearStr, monthStr, dayStr] = date.split('-')
    const [hourStr, minuteStr] = time.split(':')
    const year = Number(yearStr)
    const month = Number(monthStr)
    const day = Number(dayStr)
    const hour = Number(hourStr)
    const minute = Number(minuteStr)
    const ms = Date.UTC(year, month - 1, day, hour, minute, 0)
    return new Date(ms).toISOString()
  }

  const proposedStartAt = $derived(
    proposedDate && proposedTime ? utcIsoFromDateTime(proposedDate, proposedTime) : ''
  )

  function formatUtc(value: string | null | undefined) {
    if (!value) return 'No date'
    const date = new Date(value)
    return `${date.toLocaleString(undefined, { timeZone: 'UTC' })} UTC`
  }

  const captainTeamOptions = $derived(
    captainTeams.map((team: any) => ({
      value: team.id,
      label: `${team.name}${team.tag ? ` [${team.tag}]` : ''}`,
    }))
  )

  const opponentTeamOptions = $derived([
    { value: '', label: 'Select opponent team' },
    ...opponentTeams.map((team: any) => ({
      value: team.id,
      label: `${team.name}${team.tag ? ` [${team.tag}]` : ''}`,
    })),
  ])

  const timeOptions = Array.from({ length: 24 * 4 }, (_, index) => {
    const totalMinutes = index * 15
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0')
    const mm = String(totalMinutes % 60).padStart(2, '0')
    const label = `${hh}:${mm} UTC`
    return { value: `${hh}:${mm}`, label }
  })

  async function createProposal() {
    isSubmitting = true
    message = null
    try {
      const response = await fetch('/api/matches/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposedByTeamId,
          opponentTeamId,
          proposedStartAt,
          bestOf,
          notes,
        }),
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Failed to create proposal')

      proposals = [result.proposal, ...proposals]
      message = { type: 'success', text: 'Proposal created.' }
      notes = ''
    } catch (err) {
      message = {
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to create proposal',
      }
    } finally {
      isSubmitting = false
    }
  }

  async function changeProposalStatus(id: string, action: string) {
    try {
      const response = await fetch(`/api/matches/proposals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message || 'Failed to update proposal')
      proposals = proposals.map((proposal) =>
        proposal.id === id ? { ...proposal, status: result.proposal.status } : proposal
      )
      message = { type: 'success', text: `Proposal ${action.replaceAll('_', ' ')}.` }
    } catch (err) {
      message = {
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update proposal',
      }
    }
  }

  function isOwnProposal(proposal: any) {
    return captainTeamIds.includes(proposal.proposed_by_team_id)
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl">
      <div class="mb-6 flex items-center gap-3">
        <CalendarDays size={36} style="color: var(--text);" />
        <div>
          <h1 class="responsive-title">Captain Match Proposals</h1>
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">
            Create and respond to match proposals.
          </p>
        </div>
      </div>

      {#if message}
        <div
          class="mb-4 rounded-md px-3 py-2 text-sm"
          style={message.type === 'success'
            ? 'background: rgba(74,222,128,0.2); color: #4ade80;'
            : 'background: rgba(248,113,113,0.2); color: #f87171;'}
        >
          {message.text}
        </div>
      {/if}

      <section class="info-card info-card-surface mb-4">
        <h2 class="mb-3 text-lg font-semibold" style="color: var(--title);">Propose Match</h2>
        <p class="mb-3 text-xs" style="color: rgba(255,255,255,0.72);">
          All scheduled times are entered and displayed in UTC.
        </p>
        {#if captainTeams.length === 0}
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">
            You must be a captain/manager on a team to propose matches.
          </p>
        {:else}
          <form
            class="grid grid-cols-1 gap-3 md:grid-cols-2"
            onsubmit={(e) => {
              e.preventDefault()
              createProposal()
            }}
          >
            <div>
              <div
                class="mb-1 text-xs font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.7);"
              >
                Your Team
              </div>
              <CustomSelect options={captainTeamOptions} bind:value={proposedByTeamId} />
            </div>

            <div>
              <div
                class="mb-1 text-xs font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.7);"
              >
                Opponent
              </div>
              <CustomSelect
                options={opponentTeamOptions}
                bind:value={opponentTeamId}
                required={true}
              />
            </div>

            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <div
                  class="mb-1 text-xs font-semibold tracking-wide uppercase"
                  style="color: rgba(255,255,255,0.7);"
                >
                  Date
                </div>
                <input
                  type="date"
                  bind:value={proposedDate}
                  class="w-full rounded-md border px-3 py-2"
                  style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                  required
                />
              </div>
              <div>
                <div
                  class="mb-1 text-xs font-semibold tracking-wide uppercase"
                  style="color: rgba(255,255,255,0.7);"
                >
                  Time
                </div>
                <CustomSelect options={timeOptions} bind:value={proposedTime} required={true} />
              </div>
            </div>

            <div>
              <div
                class="mb-1 text-xs font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.7);"
              >
                Series
              </div>
              <div
                class="rounded-md border px-3 py-2 text-sm"
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: rgba(255,255,255,0.85);"
              >
                Best of 3 (fixed)
              </div>
            </div>

            <textarea
              bind:value={notes}
              rows="3"
              placeholder="Proposal notes"
              class="rounded-md border px-3 py-2 md:col-span-2"
              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
            ></textarea>

            <button
              type="submit"
              disabled={isSubmitting}
              class="rounded-md px-4 py-2 font-semibold md:col-span-2"
              style="background: var(--accent); color: var(--text);"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Proposal'}
            </button>
          </form>
        {/if}
      </section>

      <section class="info-card info-card-surface">
        <h2 class="mb-3 text-lg font-semibold" style="color: var(--title);">Proposals</h2>
        {#if proposals.length === 0}
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">No proposals yet.</p>
        {:else}
          <div class="flex flex-col gap-2">
            {#each proposals as proposal}
              <article
                class="rounded-md border p-3"
                style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="text-sm" style="color: var(--text);">
                    <strong>{proposal.proposed_team?.name ?? 'Team A'}</strong>
                    <span> vs </span>
                    <strong>{proposal.opponent_team?.name ?? 'Team B'}</strong>
                  </div>
                  <span
                    class="rounded-full px-2 py-1 text-xs font-bold"
                    style="background: rgba(255,255,255,0.12); color: var(--text);"
                  >
                    {proposal.status}
                  </span>
                </div>
                <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.72);">
                  BO{proposal.best_of} • {formatUtc(proposal.proposed_start_at)}
                </div>

                <div class="mt-2 flex flex-wrap gap-2">
                  {#if !isOwnProposal(proposal) && proposal.status === 'pending'}
                    <button
                      type="button"
                      class="rounded px-2 py-1 text-xs"
                      style="background: rgba(74,222,128,0.2); color: #4ade80;"
                      onclick={() => changeProposalStatus(proposal.id, 'accept')}>Accept</button
                    >
                    <button
                      type="button"
                      class="rounded px-2 py-1 text-xs"
                      style="background: rgba(248,113,113,0.2); color: #f87171;"
                      onclick={() => changeProposalStatus(proposal.id, 'decline')}>Decline</button
                    >
                  {/if}

                  {#if isOwnProposal(proposal) && ['pending', 'accepted', 'declined'].includes(proposal.status)}
                    <button
                      type="button"
                      class="rounded px-2 py-1 text-xs"
                      style="background: rgba(248,113,113,0.2); color: #f87171;"
                      onclick={() => changeProposalStatus(proposal.id, 'withdraw')}>Withdraw</button
                    >
                  {/if}

                  {#if proposal.status === 'accepted'}
                    <button
                      type="button"
                      class="rounded px-2 py-1 text-xs"
                      style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                      onclick={() => changeProposalStatus(proposal.id, 'submit_admin_review')}
                      >Send to Admin Review</button
                    >
                  {/if}
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  </div>
</PageContainer>
