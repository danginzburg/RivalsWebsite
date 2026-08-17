<script lang="ts">
  import { onMount } from 'svelte'

  type PendingAccount = {
    id: string
    riot_name: string
    riot_tag: string
    riot_puuid: string | null
    status: string
    label: string | null
    profile: { id: string; name: string }
  }

  let accounts = $state<PendingAccount[]>([])
  let loaded = $state(false)
  let busyId = $state<string | null>(null)
  let errorMessage = $state<string | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/admin/riot-accounts?status=pending')
      if (!res.ok) {
        errorMessage = `Failed to load pending accounts (${res.status}).`
        return
      }
      const body = await res.json()
      accounts = body.accounts ?? []
    } finally {
      loaded = true
    }
  }

  onMount(load)

  async function review(id: string, status: 'approved' | 'rejected') {
    busyId = id
    errorMessage = null
    try {
      const res = await fetch('/api/admin/riot-accounts', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        errorMessage = body?.message ?? `Failed to update account (${res.status}).`
        return
      }
      accounts = accounts.filter((a) => a.id !== id)
    } finally {
      busyId = null
    }
  }
</script>

{#if !loaded || accounts.length > 0}
  <section class="panel">
    <div class="panel-head">
      <span class="panel-title">Pending alternate accounts</span>
      {#if accounts.length > 0}<span class="count">{accounts.length}</span>{/if}
    </div>

    {#if errorMessage}
      <div class="error">{errorMessage}</div>
    {/if}

    {#if !loaded}
      <div class="muted">Loading…</div>
    {:else}
      {#each accounts as account (account.id)}
        <div class="row">
          <div class="row-main">
            <a class="player" href={`/players/${account.profile.id}`}>{account.profile.name}</a>
            <span class="riot">
              {account.riot_name}{#if account.riot_tag}<span class="tag">#{account.riot_tag}</span
                >{/if}
            </span>
            {#if account.label}<span class="label">{account.label}</span>{/if}
            {#if !account.riot_puuid}<span class="warn">no PUUID</span>{/if}
          </div>
          <div class="actions">
            <button
              type="button"
              class="reject"
              disabled={busyId === account.id}
              onclick={() => review(account.id, 'rejected')}
            >
              Reject
            </button>
            <button
              type="button"
              class="approve"
              disabled={busyId === account.id}
              onclick={() => review(account.id, 'approved')}
            >
              {busyId === account.id ? '…' : 'Approve'}
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </section>
{/if}

<style>
  .panel {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.625rem;
    background: rgba(0, 0, 0, 0.2);
    padding: 0.875rem 1rem;
    margin-bottom: 1rem;
  }
  .panel-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.625rem;
  }
  .panel-title {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.6);
  }
  .count {
    font-size: 0.625rem;
    font-weight: 700;
    padding: 0.0625rem 0.4375rem;
    border-radius: 9999px;
    background: rgba(251, 191, 36, 0.16);
    color: #fcd34d;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem 0;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    flex-wrap: wrap;
  }
  .row:first-of-type {
    border-top: none;
  }
  .row-main {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-wrap: wrap;
    min-width: 0;
  }
  .player {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
  }
  .player:hover {
    text-decoration: underline;
  }
  .riot {
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.8);
  }
  .tag {
    color: rgba(255, 255, 255, 0.5);
  }
  .label {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.55);
    background: rgba(255, 255, 255, 0.06);
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
  }
  .warn {
    font-size: 0.625rem;
    color: #fcd34d;
  }
  .actions {
    display: flex;
    gap: 0.375rem;
  }
  .approve,
  .reject {
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    border: none;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
  }
  .approve {
    background: rgba(74, 222, 128, 0.2);
    color: #4ade80;
  }
  .reject {
    background: rgba(248, 113, 113, 0.14);
    color: #fca5a5;
  }
  .approve:disabled,
  .reject:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .muted {
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.5);
  }
  .error {
    margin-bottom: 0.5rem;
    font-size: 0.75rem;
    color: #fca5a5;
  }
</style>
