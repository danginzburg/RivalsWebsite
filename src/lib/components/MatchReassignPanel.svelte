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
      .map((p: { profile_id: string; display_name: string | null; email: string | null }) => ({
        value: p.profile_id,
        label: p.display_name ?? p.email ?? 'Player',
      }))
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

<style src="./MatchReassignPanel.css"></style>
