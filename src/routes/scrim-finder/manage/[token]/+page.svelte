<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import ContentSection from '$lib/components/ContentSection.svelte'
  import { CheckCircle2, Shield, XCircle } from 'lucide-svelte'

  let { data } = $props()

  let slot = $state(data.slot)
  let claims = $state(data.claims ?? [])
  let claim = $state(data.claim ?? null)
  let slotToken = $state<string | null>(data.slotToken ?? null)
  let claimToken = $state<string | null>(data.claimToken ?? null)
  let actionPending = $state<Record<string, boolean>>({})
  let message = $state<{ type: 'success' | 'error'; text: string } | null>(null)

  function setActionPending(key: string, value: boolean) {
    actionPending[key] = value
    actionPending = { ...actionPending }
  }

  async function parseApiResponse(response: Response) {
    const text = await response.text()
    if (!text) return {}
    try {
      return JSON.parse(text)
    } catch {
      return { message: text }
    }
  }

  async function cancelSlot() {
    if (!slotToken) return
    setActionPending('cancel', true)
    message = null
    try {
      const response = await fetch(`/api/scrim-finder/slots/${slot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', token: slotToken }),
      })
      const result = await parseApiResponse(response)
      if (!response.ok) throw new Error(result.message || 'Failed to cancel slot')
      slot = { ...slot, status: 'cancelled' }
      claims = claims.map((entry: any) =>
        entry.status === 'pending' ? { ...entry, status: 'rejected' } : entry
      )
      message = { type: 'success', text: 'Slot cancelled.' }
    } catch (err) {
      message = {
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to cancel slot',
      }
    } finally {
      setActionPending('cancel', false)
    }
  }

  async function updateClaimStatus(claimId: string, action: 'accept' | 'reject') {
    if (!slotToken) return
    setActionPending(`${action}:${claimId}`, true)
    message = null
    try {
      const response = await fetch(`/api/scrim-finder/claims/${claimId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, slotToken }),
      })
      const result = await parseApiResponse(response)
      if (!response.ok) throw new Error(result.message || 'Failed to update claim')

      if (action === 'accept') {
        slot = { ...slot, status: 'filled' }
        claims = claims.map((entry: any) =>
          entry.id === claimId ? { ...entry, status: 'accepted' } : { ...entry, status: 'rejected' }
        )
        message = { type: 'success', text: 'Claim accepted. Slot is now filled.' }
      } else {
        claims = claims.map((entry: any) =>
          entry.id === claimId ? { ...entry, status: 'rejected' } : entry
        )
        const remainingPending = claims.some((entry: any) => entry.status === 'pending')
        slot = { ...slot, status: remainingPending ? 'pending_selection' : 'open' }
        message = { type: 'success', text: 'Claim rejected.' }
      }
    } catch (err) {
      message = {
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update claim',
      }
    } finally {
      setActionPending(`${action}:${claimId}`, false)
    }
  }

  async function withdrawClaim() {
    if (!claimToken || !claim) return
    setActionPending('withdraw', true)
    message = null
    try {
      const response = await fetch(`/api/scrim-finder/claims/${claim.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'withdraw', claimToken }),
      })
      const result = await parseApiResponse(response)
      if (!response.ok) throw new Error(result.message || 'Failed to withdraw claim')
      claim = { ...claim, status: 'withdrawn' }
      message = { type: 'success', text: 'Claim withdrawn.' }
    } catch (err) {
      message = {
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to withdraw claim',
      }
    } finally {
      setActionPending('withdraw', false)
    }
  }
</script>

<PageContainer>
  <ContentSection>
    <div class="mb-4 flex items-center gap-2">
      <Shield size={20} style="color: var(--title);" />
      <h1 class="responsive-title">Scrim Finder Management</h1>
    </div>

    {#if message}
      <div
        class="mb-3 rounded-md px-3 py-2 text-sm"
        style={message.type === 'success'
          ? 'background: rgba(74,222,128,0.2); color: #4ade80;'
          : 'background: rgba(248,113,113,0.2); color: #f87171;'}
      >
        {message.text}
      </div>
    {/if}

    <section class="info-card info-card-surface mb-4">
      <h2 class="text-lg font-semibold" style="color: var(--title);">
        Slot: {slot.teamName} ({slot.status})
      </h2>
      <p class="text-sm" style="color: rgba(255,255,255,0.78);">
        Rep: {slot.repName} • Discord: {slot.discordHandle}
      </p>
      <p class="text-sm" style="color: rgba(255,255,255,0.78);">
        Scheduled: {new Date(slot.scheduledAt).toLocaleString()}
      </p>
      {#if slot.notes}
        <p class="mt-2 text-sm" style="color: rgba(255,255,255,0.86);">{slot.notes}</p>
      {/if}
      {#if slot.targetTeamName}
        <p class="mt-2 text-sm" style="color: rgba(255,255,255,0.86);">
          Target team: {slot.targetTeamName}
        </p>
      {/if}
    </section>

    {#if data.mode === 'slot'}
      <section class="info-card info-card-surface mb-4">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold" style="color: var(--title);">Incoming Claims</h2>
          <button
            type="button"
            class="rounded-md px-3 py-2 text-sm font-semibold"
            style="background: rgba(248,113,113,0.2); color: #f87171;"
            onclick={cancelSlot}
            disabled={!!actionPending.cancel ||
              ['filled', 'cancelled', 'expired'].includes(slot.status)}
          >
            Cancel Slot
          </button>
        </div>

        {#if claims.length === 0}
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">No claims yet.</p>
        {:else}
          <div class="flex flex-col gap-2">
            {#each claims as entry}
              <article
                class="rounded-md border p-3"
                style="border-color: rgba(255,255,255,0.14); background: rgba(0,0,0,0.18);"
              >
                <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <div class="font-semibold" style="color: var(--text);">{entry.teamName}</div>
                  <span class="text-xs uppercase" style="color: rgba(255,255,255,0.7);">
                    {entry.status}
                  </span>
                </div>
                <p class="text-xs" style="color: rgba(255,255,255,0.75);">
                  Rep: {entry.repName} • Discord: {entry.discordHandle}
                </p>
                {#if entry.message}
                  <p class="mt-1 text-sm" style="color: rgba(255,255,255,0.85);">{entry.message}</p>
                {/if}

                {#if entry.status === 'pending' && slot.status !== 'cancelled' && slot.status !== 'filled'}
                  <div class="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="rounded px-2 py-1 text-xs font-semibold"
                      style="background: rgba(74,222,128,0.2); color: #4ade80;"
                      onclick={() => updateClaimStatus(entry.id, 'accept')}
                      disabled={!!actionPending[`accept:${entry.id}`]}
                    >
                      <span class="inline-flex items-center gap-1">
                        <CheckCircle2 size={12} />
                        Accept
                      </span>
                    </button>
                    <button
                      type="button"
                      class="rounded px-2 py-1 text-xs font-semibold"
                      style="background: rgba(248,113,113,0.2); color: #f87171;"
                      onclick={() => updateClaimStatus(entry.id, 'reject')}
                      disabled={!!actionPending[`reject:${entry.id}`]}
                    >
                      <span class="inline-flex items-center gap-1">
                        <XCircle size={12} />
                        Reject
                      </span>
                    </button>
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        {/if}
      </section>
    {:else if data.mode === 'claim' && claim}
      <section class="info-card info-card-surface">
        <h2 class="mb-2 text-lg font-semibold" style="color: var(--title);">Your Claim</h2>
        <p class="text-sm" style="color: rgba(255,255,255,0.78);">
          Team: {claim.teamName} • Rep: {claim.repName} • Discord: {claim.discordHandle}
        </p>
        <p class="text-sm" style="color: rgba(255,255,255,0.78);">Status: {claim.status}</p>
        {#if claim.message}
          <p class="mt-2 text-sm" style="color: rgba(255,255,255,0.85);">{claim.message}</p>
        {/if}
        <div class="mt-3">
          <button
            type="button"
            class="rounded-md px-3 py-2 text-sm font-semibold"
            style="background: rgba(248,113,113,0.2); color: #f87171;"
            onclick={withdrawClaim}
            disabled={!!actionPending.withdraw || claim.status !== 'pending'}
          >
            Withdraw Claim
          </button>
        </div>
      </section>
    {/if}
  </ContentSection>
</PageContainer>
