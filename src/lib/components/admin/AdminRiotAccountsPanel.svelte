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

  let {
    onReviewed,
    hiddenProfileIds = [],
  }: {
    onReviewed?: () => void
    /** Players whose alts are reviewed elsewhere: inside their signup. */
    hiddenProfileIds?: string[]
  } = $props()

  let allAccounts = $state<PendingAccount[]>([])
  const accounts = $derived(allAccounts.filter((a) => !hiddenProfileIds.includes(a.profile.id)))
  let busyId = $state<string | null>(null)
  let errorMessage = $state<string | null>(null)

  async function load() {
    const res = await fetch('/api/admin/riot-accounts?status=pending')
    if (!res.ok) {
      errorMessage = `Failed to load pending accounts (${res.status}).`
      return
    }
    const body = await res.json()
    allAccounts = body.accounts ?? []
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
      allAccounts = allAccounts.filter((a) => a.id !== id)
      onReviewed?.()
    } finally {
      busyId = null
    }
  }
</script>

{#if accounts.length > 0 || errorMessage}
  <section class="panel">
    <div class="panel-head">
      <span class="panel-title">Pending alternate accounts</span>
      {#if accounts.length > 0}<span class="count">{accounts.length}</span>{/if}
    </div>

    {#if errorMessage}
      <div class="error">{errorMessage}</div>
    {/if}

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
  </section>
{/if}

<style src="./AdminRiotAccountsPanel.css"></style>
