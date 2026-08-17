<script lang="ts">
  import { onMount } from 'svelte'
  import { invalidateAll } from '$app/navigation'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { ArrowRightLeft, ChevronDown } from 'lucide-svelte'

  type RosterPlayer = {
    puuid: string | null
    playerName: string
    profileId: string | null
    profileName: string | null
  }

  type Reassignment = {
    id: string
    puuid: string | null
    player_name: string | null
    profile_id: string
  }

  let { matchId, players = [] }: { matchId: string; players?: RosterPlayer[] } = $props()

  let reassignments = $state<Reassignment[]>([])
  let profileOptions = $state<Array<{ label: string; value: string }>>([])
  let openFor = $state<string | null>(null)
  let busyKey = $state<string | null>(null)
  let errorMessage = $state<string | null>(null)
  let expanded = $state(false)

  // One entry per distinct source account in the match.
  const roster = $derived.by(() => {
    const seen = new Set<string>()
    const out: RosterPlayer[] = []
    for (const p of players) {
      const key = p.puuid ?? p.playerName
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(p)
    }
    return out
  })

  function keyFor(p: RosterPlayer): string {
    return p.puuid ?? p.playerName
  }

  function activeFor(p: RosterPlayer): Reassignment | null {
    return (
      reassignments.find((r) => (p.puuid ? r.puuid === p.puuid : r.player_name === p.playerName)) ??
      null
    )
  }

  function labelForProfile(id: string): string {
    return profileOptions.find((o) => o.value === id)?.label ?? 'another player'
  }

  async function loadReassignments() {
    const res = await fetch(`/api/admin/matches/${matchId}/reassign`)
    if (res.ok) reassignments = (await res.json()).reassignments ?? []
  }

  async function loadProfiles() {
    if (profileOptions.length > 0) return
    const res = await fetch('/api/admin/players')
    if (!res.ok) return
    const body = await res.json()
    profileOptions = (body.players ?? [])
      .map(
        (p: {
          profile_id: string
          riot_id_base: string | null
          display_name: string | null
          email: string | null
        }) => ({
          value: p.profile_id,
          label: p.display_name ?? p.riot_id_base ?? p.email ?? 'Player',
        })
      )
      .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label))
  }

  onMount(loadReassignments)

  async function reassign(p: RosterPlayer, profileId: string) {
    if (!profileId) return
    busyKey = keyFor(p)
    errorMessage = null
    try {
      const res = await fetch(`/api/admin/matches/${matchId}/reassign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          puuid: p.puuid,
          playerName: p.puuid ? null : p.playerName,
          profileId,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        errorMessage = body?.message ?? `Failed to reassign (${res.status}).`
        return
      }
      openFor = null
      await loadReassignments()
      await invalidateAll()
    } finally {
      busyKey = null
    }
  }

  async function clear(p: RosterPlayer, reassignmentId: string) {
    busyKey = keyFor(p)
    errorMessage = null
    try {
      const res = await fetch(
        `/api/admin/matches/${matchId}/reassign?id=${encodeURIComponent(reassignmentId)}`,
        {
          method: 'DELETE',
        }
      )
      if (res.ok) {
        await loadReassignments()
        await invalidateAll()
      }
    } finally {
      busyKey = null
    }
  }

  async function openPicker(p: RosterPlayer) {
    await loadProfiles()
    openFor = keyFor(p)
  }
</script>

<section class="panel" class:open={expanded}>
  <button
    type="button"
    class="panel-head"
    aria-expanded={expanded}
    onclick={() => (expanded = !expanded)}
  >
    <ArrowRightLeft size={13} />
    <span class="panel-title">Reassign stats (admin)</span>
    {#if reassignments.length > 0}<span class="badge">{reassignments.length}</span>{/if}
    <ChevronDown size={15} class="chevron" />
  </button>

  {#if expanded}
    <p class="intro">
      Credit a player's stats in this match to a different profile — for when someone played on
      another account. Scoped to this match and kept through re-imports.
    </p>

    {#if errorMessage}<div class="error">{errorMessage}</div>{/if}

    <div class="rows">
      {#each roster as p (keyFor(p))}
        {@const active = activeFor(p)}
        <div class="row">
          <div class="row-main">
            <span class="name">{p.playerName}</span>
            {#if active}
              <span class="arrow">→ credited to <b>{labelForProfile(active.profile_id)}</b></span>
            {:else}
              <span class="current">{p.profileName ?? 'Unassigned'}</span>
            {/if}
          </div>

          <div class="row-actions">
            {#if active}
              <button
                type="button"
                class="clear-btn"
                disabled={busyKey === keyFor(p)}
                onclick={() => clear(p, active.id)}
              >
                Clear
              </button>
            {:else if openFor === keyFor(p)}
              <div class="picker">
                <CustomSelect
                  options={profileOptions}
                  value=""
                  compact={true}
                  onSelect={(value: string) => reassign(p, value)}
                />
                <button type="button" class="cancel-btn" onclick={() => (openFor = null)}
                  >Cancel</button
                >
              </div>
            {:else}
              <button
                type="button"
                class="reassign-btn"
                disabled={busyKey === keyFor(p)}
                onclick={() => openPicker(p)}
              >
                Reassign
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .panel {
    border: 1px solid rgba(168, 85, 247, 0.22);
    border-radius: 0.625rem;
    background: rgba(168, 85, 247, 0.06);
    padding: 0.875rem 1rem;
    margin-top: 1rem;
  }
  .panel-head {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    color: #d8b4fe;
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }
  .panel-title {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.125rem;
    height: 1.125rem;
    padding: 0 0.3125rem;
    border-radius: 999px;
    background: rgba(168, 85, 247, 0.25);
    color: #e9d5ff;
    font-size: 0.625rem;
    font-weight: 700;
  }
  .panel-head :global(.chevron) {
    margin-left: auto;
    transition: transform 0.15s ease;
  }
  .panel.open .panel-head :global(.chevron) {
    transform: rotate(180deg);
  }
  .intro {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
    line-height: 1.5;
    margin: 0.375rem 0 0.75rem;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.4375rem 0;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    flex-wrap: wrap;
  }
  .row:first-child {
    border-top: none;
  }
  .row-main {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    min-width: 0;
  }
  .name {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text);
  }
  .current {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }
  .arrow {
    font-size: 0.75rem;
    color: #c4b5fd;
  }
  .picker {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .reassign-btn,
  .clear-btn,
  .cancel-btn {
    padding: 0.3125rem 0.625rem;
    border-radius: 0.375rem;
    border: none;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
  }
  .reassign-btn {
    background: rgba(168, 85, 247, 0.2);
    color: #d8b4fe;
  }
  .clear-btn {
    background: rgba(248, 113, 113, 0.14);
    color: #fca5a5;
  }
  .cancel-btn {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.65);
  }
  .reassign-btn:disabled,
  .clear-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .error {
    margin-bottom: 0.5rem;
    font-size: 0.75rem;
    color: #fca5a5;
  }
</style>
