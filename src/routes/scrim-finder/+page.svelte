<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import ContentSection from '$lib/components/ContentSection.svelte'
  import { CalendarDays, Clock3, Link2, Send, Users } from 'lucide-svelte'

  type Slot = {
    id: string
    slotType: 'open' | 'targeted'
    status: 'open' | 'pending_selection' | 'filled' | 'cancelled' | 'expired'
    teamName: string
    repName: string
    discordHandle: string
    targetTeamName: string | null
    scheduledAt: string
    notes: string | null
    createdAt: string
    pendingClaimsCount: number
    acceptedClaim: null | {
      id: string
      teamName: string
      repName: string
      discordHandle: string
      message: string | null
      createdAt: string
    }
  }

  let { data } = $props()
  let slots = $state<Slot[]>(data.slots ?? [])

  let teamName = $state('')
  let repName = $state('')
  let discordHandle = $state('')
  let slotType = $state<'open' | 'targeted'>('open')
  let targetTeamName = $state('')
  let dateTimeLocal = $state('')
  let notes = $state('')

  let createPending = $state(false)
  let createMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null)
  let createdManageUrl = $state('')

  let claimForms = $state<
    Record<string, { teamName: string; repName: string; discordHandle: string; message: string }>
  >({})
  let claimSubmitting = $state<Record<string, boolean>>({})
  let claimMessages = $state<Record<string, { type: 'success' | 'error'; text: string } | null>>({})
  let claimManageLinks = $state<Record<string, string>>({})

  function formatLocalDateTime(value: string) {
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return 'Invalid time'
    return date.toLocaleString()
  }

  function getStatusLabel(status: Slot['status']) {
    if (status === 'pending_selection') return 'Claims Pending'
    return status.charAt(0).toUpperCase() + status.slice(1)
  }

  function upsertSlot(updated: Slot) {
    const idx = slots.findIndex((slot: Slot) => slot.id === updated.id)
    if (idx === -1) {
      slots = [updated, ...slots]
      return
    }
    slots[idx] = updated
    slots = [...slots]
  }

  function getClaimForm(slotId: string) {
    if (!claimForms[slotId]) {
      claimForms[slotId] = { teamName: '', repName: '', discordHandle: '', message: '' }
      claimForms = { ...claimForms }
    }
    return claimForms[slotId]
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

  async function createSlot() {
    createPending = true
    createMessage = null
    try {
      if (!dateTimeLocal) throw new Error('Date and time are required')
      const scheduledAt = new Date(dateTimeLocal).toISOString()
      const response = await fetch('/api/scrim-finder/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamName,
          repName,
          discordHandle,
          slotType,
          targetTeamName: slotType === 'targeted' ? targetTeamName : null,
          scheduledAt,
          notes,
        }),
      })
      const result = await parseApiResponse(response)
      if (!response.ok) throw new Error(result.message || 'Failed to create slot')

      upsertSlot(result.slot)
      createdManageUrl = result.manageUrl || ''
      createMessage = { type: 'success', text: 'Slot posted successfully.' }

      teamName = ''
      repName = ''
      discordHandle = ''
      slotType = 'open'
      targetTeamName = ''
      dateTimeLocal = ''
      notes = ''
    } catch (err) {
      createMessage = {
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to create slot',
      }
    } finally {
      createPending = false
    }
  }

  async function submitClaim(slotId: string) {
    claimSubmitting[slotId] = true
    claimMessages[slotId] = null
    claimSubmitting = { ...claimSubmitting }
    claimMessages = { ...claimMessages }

    try {
      const form = getClaimForm(slotId)
      const response = await fetch(`/api/scrim-finder/slots/${slotId}/claims`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const result = await parseApiResponse(response)
      if (!response.ok) throw new Error(result.message || 'Failed to submit claim')

      claimMessages[slotId] = {
        type: 'success',
        text: 'Claim submitted. Save your claim manage link.',
      }
      claimManageLinks[result.claim.id] = result.manageUrl
      claimForms[slotId] = { teamName: '', repName: '', discordHandle: '', message: '' }
      claimMessages = { ...claimMessages }
      claimManageLinks = { ...claimManageLinks }
      claimForms = { ...claimForms }

      const slot = slots.find((entry: Slot) => entry.id === slotId)
      if (slot) {
        const wasOpen = slot.status === 'open'
        slot.pendingClaimsCount += 1
        if (wasOpen) slot.status = 'pending_selection'
        slots = [...slots]
      }
    } catch (err) {
      claimMessages[slotId] = {
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to submit claim',
      }
      claimMessages = { ...claimMessages }
    } finally {
      claimSubmitting[slotId] = false
      claimSubmitting = { ...claimSubmitting }
    }
  }
</script>

<PageContainer>
  <ContentSection>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <CalendarDays size={34} style="color: var(--text);" />
        <div>
          <h1 class="responsive-title">Scrim Finder</h1>
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">
            Post open scrim slots or claim one from another team.
          </p>
        </div>
      </div>
    </div>

    <section class="info-card info-card-surface mb-5">
      <div class="mb-3 flex items-center gap-2">
        <Send size={18} style="color: var(--title);" />
        <h2 class="text-lg font-semibold" style="color: var(--title);">Post a Scrim Slot</h2>
      </div>

      {#if createMessage}
        <div
          class="mb-3 rounded-md px-3 py-2 text-sm"
          style={createMessage.type === 'success'
            ? 'background: rgba(74,222,128,0.2); color: #4ade80;'
            : 'background: rgba(248,113,113,0.2); color: #f87171;'}
        >
          {createMessage.text}
        </div>
      {/if}

      {#if createdManageUrl}
        <div
          class="mb-3 rounded-md border px-3 py-2 text-sm"
          style="border-color: rgba(99,102,241,0.45); background: rgba(15,23,42,0.4); color: #c7d2fe;"
        >
          <div class="mb-1 flex items-center gap-2 font-semibold">
            <Link2 size={14} />
            Save this private manage link now
          </div>
          <a href={createdManageUrl} class="break-all underline" style="color: #c7d2fe;">
            {createdManageUrl}
          </a>
        </div>
      {/if}

      <form
        class="grid grid-cols-1 gap-3 md:grid-cols-2"
        onsubmit={(event) => {
          event.preventDefault()
          createSlot()
        }}
      >
        <input
          class="rounded-md border px-3 py-2"
          style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.28); color: var(--text);"
          placeholder="Your team name"
          bind:value={teamName}
          required
        />
        <input
          class="rounded-md border px-3 py-2"
          style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.28); color: var(--text);"
          placeholder="Representative name"
          bind:value={repName}
          required
        />
        <input
          class="rounded-md border px-3 py-2"
          style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.28); color: var(--text);"
          placeholder="Discord handle (required)"
          bind:value={discordHandle}
          required
        />
        <select
          bind:value={slotType}
          class="rounded-md border px-3 py-2"
          style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.28); color: var(--text);"
        >
          <option value="open">Open slot (any team can claim)</option>
          <option value="targeted">Targeted slot (one team name)</option>
        </select>
        {#if slotType === 'targeted'}
          <input
            class="rounded-md border px-3 py-2 md:col-span-2"
            style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.28); color: var(--text);"
            placeholder="Target team name"
            bind:value={targetTeamName}
            required
          />
        {/if}
        <input
          type="datetime-local"
          class="rounded-md border px-3 py-2"
          style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.28); color: var(--text);"
          bind:value={dateTimeLocal}
          required
        />
        <textarea
          rows="3"
          class="rounded-md border px-3 py-2 md:col-span-2"
          style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.28); color: var(--text);"
          placeholder="Optional notes (map pool, server, extra details)"
          bind:value={notes}
        ></textarea>
        <button
          type="submit"
          class="rounded-md px-4 py-2 font-semibold md:col-span-2"
          style="background: var(--accent); color: var(--text);"
          disabled={createPending}
        >
          {createPending ? 'Posting...' : 'Post Slot'}
        </button>
      </form>
    </section>

    <section class="info-card info-card-surface">
      <div class="mb-3 flex items-center gap-2">
        <Users size={18} style="color: var(--title);" />
        <h2 class="text-lg font-semibold" style="color: var(--title);">Open Board</h2>
      </div>

      {#if slots.length === 0}
        <p class="text-sm" style="color: rgba(255,255,255,0.72);">No active slots yet.</p>
      {:else}
        <div class="flex flex-col gap-3">
          {#each slots as slot}
            <article
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.14); background: rgba(0,0,0,0.2);"
            >
              <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div class="text-base font-semibold" style="color: var(--title);">
                    {slot.teamName}
                  </div>
                  <div class="text-xs" style="color: rgba(255,255,255,0.72);">
                    Rep: {slot.repName} • Discord: {slot.discordHandle}
                  </div>
                </div>
                <span
                  class="rounded-full px-2 py-1 text-xs font-semibold"
                  style="background: rgba(255,255,255,0.12); color: var(--text);"
                >
                  {getStatusLabel(slot.status)}
                </span>
              </div>

              <div
                class="mb-2 grid gap-1 text-xs sm:grid-cols-2"
                style="color: rgba(255,255,255,0.78);"
              >
                <div class="flex items-center gap-1">
                  <Clock3 size={12} />
                  <span>{formatLocalDateTime(slot.scheduledAt)}</span>
                </div>
                <div>
                  <strong>Type:</strong>
                  {slot.slotType === 'targeted' ? `Targeted (${slot.targetTeamName})` : 'Open'}
                </div>
                <div><strong>Pending claims:</strong> {slot.pendingClaimsCount}</div>
                {#if slot.acceptedClaim}
                  <div>
                    <strong>Accepted:</strong>
                    {slot.acceptedClaim.teamName} ({slot.acceptedClaim.discordHandle})
                  </div>
                {/if}
              </div>

              {#if slot.notes}
                <p class="mb-2 text-sm" style="color: rgba(255,255,255,0.84);">{slot.notes}</p>
              {/if}

              {#if slot.status === 'open' || slot.status === 'pending_selection'}
                <details
                  class="rounded-md border p-2"
                  style="border-color: rgba(255,255,255,0.12);"
                >
                  <summary
                    class="cursor-pointer text-sm font-semibold"
                    style="color: var(--title);"
                  >
                    Claim This Slot
                  </summary>

                  {#if claimMessages[slot.id]}
                    <div
                      class="mt-2 rounded-md px-2 py-1 text-xs"
                      style={claimMessages[slot.id]?.type === 'success'
                        ? 'background: rgba(74,222,128,0.2); color: #4ade80;'
                        : 'background: rgba(248,113,113,0.2); color: #f87171;'}
                    >
                      {claimMessages[slot.id]?.text}
                    </div>
                  {/if}

                  <form
                    class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2"
                    onsubmit={(event) => {
                      event.preventDefault()
                      submitClaim(slot.id)
                    }}
                  >
                    <input
                      class="rounded-md border px-2 py-1"
                      style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.22); color: var(--text);"
                      placeholder="Your team name"
                      value={getClaimForm(slot.id).teamName}
                      oninput={(event) => {
                        getClaimForm(slot.id).teamName = (
                          event.currentTarget as HTMLInputElement
                        ).value
                        claimForms = { ...claimForms }
                      }}
                      required
                    />
                    <input
                      class="rounded-md border px-2 py-1"
                      style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.22); color: var(--text);"
                      placeholder="Representative name"
                      value={getClaimForm(slot.id).repName}
                      oninput={(event) => {
                        getClaimForm(slot.id).repName = (
                          event.currentTarget as HTMLInputElement
                        ).value
                        claimForms = { ...claimForms }
                      }}
                      required
                    />
                    <input
                      class="rounded-md border px-2 py-1"
                      style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.22); color: var(--text);"
                      placeholder="Discord handle"
                      value={getClaimForm(slot.id).discordHandle}
                      oninput={(event) => {
                        getClaimForm(slot.id).discordHandle = (
                          event.currentTarget as HTMLInputElement
                        ).value
                        claimForms = { ...claimForms }
                      }}
                      required
                    />
                    <input
                      class="rounded-md border px-2 py-1"
                      style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.22); color: var(--text);"
                      placeholder="Optional message"
                      value={getClaimForm(slot.id).message}
                      oninput={(event) => {
                        getClaimForm(slot.id).message = (
                          event.currentTarget as HTMLInputElement
                        ).value
                        claimForms = { ...claimForms }
                      }}
                    />
                    <button
                      type="submit"
                      class="rounded-md px-3 py-2 text-sm font-semibold md:col-span-2"
                      style="background: rgba(59,130,246,0.25); color: #bfdbfe;"
                      disabled={!!claimSubmitting[slot.id]}
                    >
                      {claimSubmitting[slot.id] ? 'Submitting...' : 'Submit Claim'}
                    </button>
                  </form>
                </details>
              {/if}
            </article>
          {/each}
        </div>
      {/if}

      {#if Object.keys(claimManageLinks).length > 0}
        <div
          class="mt-4 rounded-md border px-3 py-2 text-sm"
          style="border-color: rgba(99,102,241,0.45); background: rgba(15,23,42,0.4); color: #c7d2fe;"
        >
          <div class="mb-1 font-semibold">Claim manage links (save now):</div>
          {#each Object.entries(claimManageLinks) as [claimId, link]}
            <div class="mb-1">
              <span class="font-semibold">Claim {claimId}:</span>
              <a class="ml-1 break-all underline" href={String(link)} style="color: #c7d2fe;"
                >{String(link)}</a
              >
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </ContentSection>
</PageContainer>
