<script lang="ts">
  import { invalidateAll } from '$app/navigation'
  import { UserCog, ChevronDown } from 'lucide-svelte'

  type RosterPlayer = {
    puuid: string | null
    playerName: string
    profileId: string | null
    profileName: string | null
    isSub: boolean
  }

  let {
    matchId,
    players = [],
    overrideByKey,
  }: {
    matchId: string
    players?: RosterPlayer[]
    /** puuid ?? name → forced value; absent key means the auto rule is in effect. */
    overrideByKey: Map<string, boolean>
  } = $props()

  let expanded = $state(false)
  let busyKey = $state<string | null>(null)
  let errorMessage = $state<string | null>(null)

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

  /** 'auto' when no override is set, otherwise the forced choice. */
  function modeFor(p: RosterPlayer): 'auto' | 'sub' | 'starter' {
    const forced = overrideByKey.get(keyFor(p))
    if (forced === undefined) return 'auto'
    return forced ? 'sub' : 'starter'
  }

  const overrideCount = $derived(roster.filter((p) => modeFor(p) !== 'auto').length)

  async function setMode(p: RosterPlayer, mode: 'auto' | 'sub' | 'starter') {
    if (modeFor(p) === mode) return
    busyKey = keyFor(p)
    errorMessage = null
    try {
      const res = await fetch(`/api/admin/matches/${matchId}/subs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          puuid: p.puuid,
          playerName: p.puuid ? null : p.playerName,
          isSub: mode === 'auto' ? null : mode === 'sub',
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        errorMessage = body?.message ?? `Failed to update (${res.status}).`
        return
      }
      await invalidateAll()
    } finally {
      busyKey = null
    }
  }
</script>

<section class="panel" class:open={expanded}>
  <button
    type="button"
    class="panel-head"
    aria-expanded={expanded}
    onclick={() => (expanded = !expanded)}
  >
    <UserCog size={13} />
    <span class="panel-title">Mark subs (admin)</span>
    {#if overrideCount > 0}<span class="badge">{overrideCount}</span>{/if}
    <ChevronDown size={15} class="chevron" />
  </button>

  {#if expanded}
    <p class="intro">
      A player not on this team's roster for the season is flagged as a sub automatically. Override
      here when the roster is incomplete. Scoped to this match and kept through re-imports.
    </p>

    {#if errorMessage}<div class="error">{errorMessage}</div>{/if}

    <div class="rows">
      {#each roster as p (keyFor(p))}
        {@const mode = modeFor(p)}
        <div class="row">
          <div class="row-main">
            <span class="name">{p.profileName ?? p.playerName}</span>
            <span class="status" class:is-sub={p.isSub}>{p.isSub ? 'Sub' : 'Starter'}</span>
            {#if mode === 'auto'}<span class="auto-tag">auto</span>{/if}
          </div>

          <div class="seg" role="group" aria-label="Sub status for {p.playerName}">
            {#each [{ value: 'auto', label: 'Auto' }, { value: 'sub', label: 'Sub' }, { value: 'starter', label: 'Starter' }] as opt (opt.value)}
              <button
                type="button"
                class="seg-btn"
                class:active={mode === opt.value}
                disabled={busyKey === keyFor(p)}
                onclick={() => setMode(p, opt.value as 'auto' | 'sub' | 'starter')}
              >
                {opt.label}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .panel {
    border: 1px solid rgba(251, 191, 36, 0.22);
    border-radius: 0.625rem;
    background: rgba(251, 191, 36, 0.06);
    padding: 0.875rem 1rem;
    margin-top: 0.75rem;
  }
  .panel-head {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    color: #fbbf24;
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
    background: rgba(251, 191, 36, 0.25);
    color: #fde68a;
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
  .status {
    font-size: 0.6875rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.5);
  }
  .status.is-sub {
    color: #fbbf24;
  }
  .auto-tag {
    font-size: 0.625rem;
    color: rgba(255, 255, 255, 0.35);
    font-style: italic;
  }
  .seg {
    display: inline-flex;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.375rem;
    overflow: hidden;
  }
  .seg-btn {
    padding: 0.3125rem 0.5625rem;
    border: none;
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.6875rem;
    font-weight: 600;
    cursor: pointer;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
  }
  .seg-btn:first-child {
    border-left: none;
  }
  .seg-btn.active {
    background: rgba(251, 191, 36, 0.2);
    color: #fde68a;
  }
  .seg-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .error {
    margin-bottom: 0.5rem;
    font-size: 0.75rem;
    color: #fca5a5;
  }
</style>
