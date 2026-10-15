<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import AdminActionConfirmationModal from '$lib/components/admin/AdminActionConfirmationModal.svelte'
  import { adminJsonRequest } from '$lib/admin/api'
  import { resolve } from '$app/paths'
  import { formatLeftDay } from '$lib/players/roster-dates'
  import { ArrowLeft, Link2, Loader2 } from 'lucide-svelte'
  import type { PageProps } from './$types'

  type Identity = {
    puuid: string
    latest_name: string | null
    latest_tag: string | null
    last_seen_at: string | null
    first_seen_at: string | null
    maps_seen: number
    /** Teams whose roster slot this account holds this season. */
    rostered_on: string[]
  }

  let { data }: PageProps = $props()

  // Seeded via a function and a derived so the props reference is not read
  // bare in an initializer (Svelte's state_referenced_locally warning).
  const getInitialIdentities = () => data.identities
  let identities = $state<Identity[]>(getInitialIdentities())
  const profiles = $derived(data.profiles)
  const profileOptions = $derived(profiles.map((p) => ({ value: p.id, label: p.label })))

  let search = $state('')
  let selection = $state<Record<string, string>>({})
  let linkingPuuid = $state<string | null>(null)
  let errorMessage = $state<string | null>(null)
  let successMessage = $state<string | null>(null)

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase()
    if (!q) return identities
    return identities.filter((i) =>
      `${i.latest_name ?? ''}#${i.latest_tag ?? ''} ${i.puuid}`.toLowerCase().includes(q)
    )
  })

  function riotId(identity: Identity): string {
    const name = identity.latest_name?.trim() || '(unknown name)'
    return identity.latest_tag ? `${name}#${identity.latest_tag}` : name
  }

  function formatDate(value: string | null): string {
    if (!value) return '—'
    const d = new Date(value)
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : '—'
  }

  type ConfirmRequest = {
    title: string
    message: string
    confirmLabel: string
    warning?: string | null
    tone?: 'default' | 'danger'
  }

  // One styled confirmation dialog for every action on the page; askConfirm
  // resolves true on confirm and false on cancel or Escape.
  let confirmRequest = $state<ConfirmRequest | null>(null)
  let resolveConfirm: ((confirmed: boolean) => void) | null = null

  function askConfirm(request: ConfirmRequest): Promise<boolean> {
    resolveConfirm?.(false)
    confirmRequest = request
    return new Promise((resolve) => (resolveConfirm = resolve))
  }

  function settleConfirm(confirmed: boolean) {
    resolveConfirm?.(confirmed)
    resolveConfirm = null
    confirmRequest = null
  }

  type RosterSlot = PageProps['data']['rosterSlots'][number]

  const getInitialSlots = () => data.rosterSlots ?? []
  let rosterSlots = $state<RosterSlot[]>(getInitialSlots())
  let slotSearch = $state('')
  let slotPick = $state<Record<number, string>>({})
  let slotTyped = $state<Record<number, string>>({})
  let savingSlotId = $state<number | null>(null)

  const filteredSlots = $derived.by(() => {
    const q = slotSearch.trim().toLowerCase()
    if (!q) return rosterSlots
    return rosterSlots.filter((slot) =>
      `${slot.player_name} ${slot.team.name} ${slot.team.tag ?? ''} ${slot.season.name}`
        .toLowerCase()
        .includes(q)
    )
  })

  /**
   * Accounts free to take the slot first; those already holding an open spot on
   * another team this season are grouped last and labelled, since an open slot
   * here would be refused for them.
   */
  function slotOptions(slot: RosterSlot) {
    const blocked = (c: RosterSlot['candidates'][number]) => Boolean(c.open_spot_on) && slot.is_open
    return [...slot.candidates]
      .sort((a, b) => Number(blocked(a)) - Number(blocked(b)))
      .map((c) => ({
        value: c.puuid,
        label: blocked(c)
          ? `${c.riot_id} · on ${c.open_spot_on}`
          : `${c.riot_id} · ${c.maps} map${c.maps === 1 ? '' : 's'}`,
        group: blocked(c) ? 'Already on another roster this season' : 'Played for this team',
      }))
  }

  /** The picked account, else the suggested one; a typed Riot ID overrides both. */
  function slotChoice(slot: RosterSlot): { riotId: string; puuid: string | null } | null {
    const typed = slotTyped[slot.id]?.trim()
    if (typed) return { riotId: typed, puuid: null }
    const puuid = slotPick[slot.id] ?? slot.suggested_puuid
    const candidate = slot.candidates.find((c) => c.puuid === puuid)
    return candidate ? { riotId: candidate.riot_id, puuid: candidate.puuid } : null
  }

  async function assignSlot(slot: RosterSlot) {
    const choice = slotChoice(slot)
    if (!choice) {
      errorMessage = `Pick or type a Riot ID for "${slot.player_name}" first.`
      return
    }
    const clash = slot.is_open
      ? slot.candidates.find((c) => c.puuid === choice.puuid)?.open_spot_on
      : null
    if (clash) {
      errorMessage = `${choice.riotId} already holds an open roster spot on ${clash} this season, and a player can only hold one. If they subbed for ${slot.team.name}, they are not this slot's player. If they moved here, close their ${clash} spot first.`
      return
    }
    if (!choice.puuid && !choice.riotId.includes('#')) {
      errorMessage = 'Type the full Riot ID (name#tag) so its PUUID can be looked up.'
      return
    }
    const confirmed = await askConfirm({
      title: 'Assign roster slot',
      message: `Set the "${slot.player_name}" slot on ${slot.team.name} (${slot.season.name}) to ${choice.riotId}?\n\nThat account will count as this roster spot in the team's matches.`,
      confirmLabel: 'Assign',
    })
    if (!confirmed) return

    savingSlotId = slot.id
    errorMessage = null
    successMessage = null
    try {
      const result = await adminJsonRequest<{
        slot: { hasPuuid: boolean; puuid: string | null }
      }>('/api/admin/teams/manage', {
        method: 'PUT',
        body: { membershipId: slot.id, riotId: choice.riotId, puuid: choice.puuid },
        fallbackMessage: 'Failed to update roster slot',
      })
      if (!result.slot.hasPuuid) {
        // Riot did not return the account: the slot is renamed but still name-only.
        errorMessage = `Renamed "${slot.player_name}" to ${choice.riotId}, but Riot did not find that account. Check the tag.`
        rosterSlots = rosterSlots.map((s) =>
          s.id === slot.id ? { ...s, player_name: choice.riotId } : s
        )
        return
      }
      successMessage = `${slot.team.name}: "${slot.player_name}" is now ${choice.riotId}.`
      rosterSlots = rosterSlots.filter((s) => s.id !== slot.id)
      // Label the same account in the review queue as rostered.
      const assignedPuuid = result.slot.puuid
      identities = identities.map((i) =>
        i.puuid === assignedPuuid && !i.rostered_on.includes(slot.team.name)
          ? { ...i, rostered_on: [...i.rostered_on, slot.team.name] }
          : i
      )
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update roster slot'
    } finally {
      savingSlotId = null
    }
  }

  // Accounts linked during this visit, which the loaded profile list predates.
  let linkedThisVisit = $state<Record<string, string[]>>({})

  async function removeSlot(slot: RosterSlot) {
    const confirmed = await askConfirm({
      title: 'Remove roster slot',
      message: `Remove the "${slot.player_name}" slot from ${slot.team.name} (${slot.season.name})?\n\nThe slot is deleted and no longer counts in this team's matches.`,
      warning: slot.duplicate_of
        ? `This looks like a duplicate of "${slot.duplicate_of}", which is already linked.`
        : 'No linked duplicate was found on this team. Only remove it if the slot was entered by mistake and the player is already on the roster under a linked slot.',
      confirmLabel: 'Remove',
      tone: 'danger',
    })
    if (!confirmed) return

    savingSlotId = slot.id
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest('/api/admin/roster-slots', {
        method: 'DELETE',
        body: { membershipId: slot.id },
        fallbackMessage: 'Failed to remove roster slot',
      })
      successMessage = `Removed "${slot.player_name}" from ${slot.team.name}.`
      rosterSlots = rosterSlots.filter((s) => s.id !== slot.id)
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to remove roster slot'
    } finally {
      savingSlotId = null
    }
  }

  async function link(identity: Identity) {
    const profileId = selection[identity.puuid]
    if (!profileId) {
      errorMessage = `Pick a player for ${riotId(identity)} first.`
      return
    }

    const profile = profiles.find((p) => p.id === profileId)
    const existing = [...(profile?.riotAccounts ?? []), ...(linkedThisVisit[profileId] ?? [])]
    const confirmed = await askConfirm({
      title: 'Link Riot account',
      message: `Link ${riotId(identity)} to ${profile?.label ?? 'this player'}?\n\nAll of its past and future stats will be credited to them.`,
      warning:
        existing.length > 0
          ? `${profile?.label ?? 'This player'} already has ${existing.length === 1 ? 'a Riot account' : `${existing.length} Riot accounts`} linked: ${existing.join(', ')}. Only continue if ${riotId(identity)} is also theirs.`
          : null,
      confirmLabel: 'Link',
    })
    if (!confirmed) return

    linkingPuuid = identity.puuid
    errorMessage = null
    successMessage = null
    try {
      const result = await adminJsonRequest<{
        relink: { matchMapRowsLinked: number; matchesRebuilt: number } | null
      }>('/api/admin/riot-identities', {
        method: 'POST',
        body: { puuid: identity.puuid, profileId },
        fallbackMessage: 'Failed to link identity',
      })

      const label = profiles.find((p) => p.id === profileId)?.label ?? 'player'
      const linked = result.relink?.matchMapRowsLinked ?? 0
      successMessage =
        `Linked ${riotId(identity)} to ${label}` +
        (linked > 0 ? ` — pooled in ${linked} stat row${linked === 1 ? '' : 's'}.` : '.')

      // Drop the now-linked identity from the queue.
      identities = identities.filter((i) => i.puuid !== identity.puuid)
      linkedThisVisit[profileId] = [...(linkedThisVisit[profileId] ?? []), riotId(identity)]
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to link identity'
    } finally {
      linkingPuuid = null
    }
  }
</script>

<PageContainer>
  <div class="flex justify-center py-6 sm:py-8">
    <div class="w-full max-w-5xl space-y-5">
      <header class="admin-import-head">
        <div class="min-w-0">
          <h1 class="admin-import-title">Player Identities</h1>
          <p class="admin-hint mt-1">
            Every Riot PUUID seen in an imported match, tracked behind the scenes regardless of name
            changes. These are the ones not yet tied to a player — link each once and all of its
            past and future stats follow the PUUID through any rename.
          </p>
        </div>
        <a href={resolve('/admin')} class="admin-back-link">
          <ArrowLeft size={14} /> Admin
        </a>
      </header>

      {#if errorMessage}
        <div class="admin-alert admin-alert-error">{errorMessage}</div>
      {/if}
      {#if successMessage}
        <div class="admin-note">{successMessage}</div>
      {/if}

      <section class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div class="admin-stat">
          <div class="admin-stat-label">Unlinked identities</div>
          <div class="admin-stat-value">{identities.length}</div>
        </div>
        <div class="admin-stat">
          <div class="admin-stat-label">Registered players</div>
          <div class="admin-stat-value">{profiles.length}</div>
        </div>
      </section>

      <section class="admin-card admin-card-pad">
        <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div class="min-w-0">
            <div class="admin-section-title">Review queue</div>
            <div class="admin-hint mt-1">
              {data.activeSeasonName
                ? `Identities that played in ${data.activeSeasonName}, ranked by how many maps each has played.`
                : 'No active season, so there is nothing to review.'}
            </div>
          </div>
          <label class="block w-full sm:max-w-xs">
            <div class="admin-field-label">Filter</div>
            <input
              type="search"
              bind:value={search}
              placeholder="Name or PUUID…"
              class="admin-input"
            />
          </label>
        </div>

        {#if filtered.length === 0}
          <div class="admin-note">
            {identities.length === 0
              ? 'No unlinked identities. Everyone who played this season is tied to a player.'
              : 'No identities match that filter.'}
          </div>
        {:else}
          <div class="table-scroll">
            <table class="min-w-full text-left text-sm">
              <thead>
                <tr class="text-xs uppercase" style="color: rgba(255, 255, 255, 0.75);">
                  <th class="px-3 py-2">Latest name</th>
                  <th class="px-3 py-2 text-right">Maps</th>
                  <th class="px-3 py-2">Last seen</th>
                  <th class="px-3 py-2">Link to player</th>
                  <th class="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {#each filtered as identity (identity.puuid)}
                  <tr class="admin-divide border-t">
                    <td class="px-3 py-2">
                      <div class="font-semibold" style="color: var(--text);">
                        {riotId(identity)}
                        {#each identity.rostered_on as teamName (teamName)}
                          <span
                            class="ml-1.5 inline-block rounded-full px-2 py-0.5 align-middle text-[10px] font-semibold uppercase"
                            style="background: rgba(74, 222, 128, 0.12); color: #86efac;"
                            title="Holds this team's roster slot; still needs linking to a player profile"
                          >
                            Rostered · {teamName}
                          </span>
                        {/each}
                      </div>
                      <div
                        class="font-mono text-[11px] break-all"
                        style="color: rgba(255, 255, 255, 0.4);"
                      >
                        {identity.puuid}
                      </div>
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums">{identity.maps_seen}</td>
                    <td class="px-3 py-2" style="color: rgba(255, 255, 255, 0.72);">
                      {formatDate(identity.last_seen_at)}
                    </td>
                    <td class="px-3 py-2" style="min-width: 12rem;">
                      <CustomSelect
                        options={profileOptions}
                        value={selection[identity.puuid] ?? ''}
                        placeholder="Select player…"
                        compact
                        onSelect={(value) => (selection[identity.puuid] = value)}
                      />
                    </td>
                    <td class="px-3 py-2 text-right">
                      <button
                        type="button"
                        class="admin-btn admin-btn-go admin-btn-sm"
                        onclick={() => link(identity)}
                        disabled={linkingPuuid === identity.puuid || !selection[identity.puuid]}
                      >
                        {#if linkingPuuid === identity.puuid}
                          <span class="inline-flex items-center gap-1.5">
                            <Loader2 size={14} class="animate-spin" /> Linking…
                          </span>
                        {:else}
                          <span class="inline-flex items-center gap-1.5">
                            <Link2 size={14} /> Link
                          </span>
                        {/if}
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>

      <section class="admin-card admin-card-pad">
        <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div class="min-w-0">
            <div class="admin-section-title">
              Roster slots without a Riot ID{data.activeSeasonName
                ? ` · ${data.activeSeasonName}`
                : ''}
            </div>
            <div class="admin-hint mt-1">
              These slots were typed as a handle and match stats by name only, so the player can
              show as a sub in their own team's matches. Point each at the Riot account that played
              for the team; it does not need to belong to a signed-in player. The suggestions are
              accounts seen in that team's matches that hold no slot on it yet.
            </div>
          </div>
          <label class="block w-full sm:max-w-xs">
            <div class="admin-field-label">Filter</div>
            <input
              type="search"
              bind:value={slotSearch}
              placeholder="Player, team or event…"
              class="admin-input"
            />
          </label>
        </div>

        {#if filteredSlots.length === 0}
          <div class="admin-note">
            {rosterSlots.length === 0
              ? 'Every roster slot is tied to a Riot ID or a player.'
              : 'No slots match that filter.'}
          </div>
        {:else}
          <div class="table-scroll">
            <table class="min-w-full text-left text-sm">
              <thead>
                <tr class="text-xs uppercase" style="color: rgba(255, 255, 255, 0.75);">
                  <th class="px-3 py-2">Slot</th>
                  <th class="px-3 py-2">Team</th>
                  <th class="px-3 py-2">Played for team</th>
                  <th class="px-3 py-2">Or type Riot ID</th>
                  <th class="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {#each filteredSlots as slot (slot.id)}
                  <tr class="admin-divide border-t">
                    <td class="px-3 py-2">
                      <div class="font-semibold" style="color: var(--text);">
                        {slot.player_name}
                      </div>
                      {#if !slot.is_open && slot.left_at}
                        <div class="text-[11px]" style="color: rgba(255, 255, 255, 0.45);">
                          Left {formatLeftDay(slot.left_at)}
                        </div>
                      {/if}
                      {#if slot.duplicate_of}
                        <div class="text-[11px]" style="color: #fbbf24;">
                          Likely duplicate of {slot.duplicate_of}
                        </div>
                      {/if}
                    </td>
                    <td class="px-3 py-2">
                      <a
                        href={resolve(`/teams/${slot.team.id}`)}
                        class="font-semibold"
                        style="color: var(--text);"
                      >
                        {slot.team.name}
                      </a>
                      <div class="text-[11px]" style="color: rgba(255, 255, 255, 0.45);">
                        {slot.season.name}{slot.team.disbanded ? ' · disbanded' : ''}
                      </div>
                    </td>
                    <td class="px-3 py-2" style="min-width: 13rem;">
                      {#if slot.candidates.length > 0}
                        <CustomSelect
                          options={slotOptions(slot)}
                          value={slotPick[slot.id] ?? slot.suggested_puuid ?? ''}
                          placeholder="Select account…"
                          compact
                          onSelect={(value) => (slotPick[slot.id] = value)}
                        />
                      {:else}
                        <span class="text-xs" style="color: rgba(255, 255, 255, 0.45);">
                          No unrostered accounts played for this team
                        </span>
                      {/if}
                    </td>
                    <td class="px-3 py-2" style="min-width: 10rem;">
                      <input
                        type="text"
                        class="admin-input"
                        placeholder="name#tag"
                        value={slotTyped[slot.id] ?? ''}
                        oninput={(event) => (slotTyped[slot.id] = event.currentTarget.value)}
                      />
                    </td>
                    <td class="px-3 py-2 text-right">
                      <button
                        type="button"
                        class="admin-btn admin-btn-go admin-btn-sm"
                        onclick={() => assignSlot(slot)}
                        disabled={savingSlotId === slot.id || !slotChoice(slot)}
                      >
                        {#if savingSlotId === slot.id}
                          <span class="inline-flex items-center gap-1.5">
                            <Loader2 size={14} class="animate-spin" /> Saving…
                          </span>
                        {:else}
                          <span class="inline-flex items-center gap-1.5">
                            <Link2 size={14} /> Assign
                          </span>
                        {/if}
                      </button>
                      <button
                        type="button"
                        class="admin-btn admin-btn-danger admin-btn-sm ml-1.5"
                        onclick={() => removeSlot(slot)}
                        disabled={savingSlotId === slot.id}
                        title="Delete a mis-entered slot"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    </div>
  </div>

  <AdminActionConfirmationModal
    open={Boolean(confirmRequest)}
    title={confirmRequest?.title ?? ''}
    message={confirmRequest?.message ?? ''}
    warning={confirmRequest?.warning ?? null}
    tone={confirmRequest?.tone ?? 'default'}
    confirmLabel={confirmRequest?.confirmLabel ?? 'Confirm'}
    onCancel={() => settleConfirm(false)}
    onConfirm={() => settleConfirm(true)}
  />
</PageContainer>
