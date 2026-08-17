<script lang="ts">
  import { enhance } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import { Plus, X, Star, Pencil } from 'lucide-svelte'

  type RiotAccount = {
    id: string
    riot_name: string
    riot_tag: string
    riot_puuid: string | null
    is_primary: boolean
    status: 'pending' | 'approved' | 'rejected'
    label: string | null
  }

  let {
    accounts = [],
    canEdit = false,
    displayName = null,
  }: {
    accounts?: RiotAccount[]
    canEdit?: boolean
    displayName?: string | null
  } = $props()

  const primary = $derived(accounts.find((a) => a.is_primary) ?? null)
  const alts = $derived(accounts.filter((a) => !a.is_primary))

  let editingName = $state(false)
  let addingAlt = $state(false)
  let altName = $state('')
  let altTag = $state('')
  let altLabel = $state('')
  let busy = $state(false)
  let errorMessage = $state<string | null>(null)

  const statusStyle: Record<string, string> = {
    pending: 'background: rgba(251,191,36,0.16); color: #fcd34d;',
    approved: 'background: rgba(74,222,128,0.16); color: #86efac;',
    rejected: 'background: rgba(248,113,113,0.16); color: #fca5a5;',
  }

  async function addAlt() {
    errorMessage = null
    if (altName.trim().length < 3 || !/^[A-Za-z0-9]{3,5}$/.test(altTag.trim())) {
      errorMessage = 'Enter a Riot name and a 3–5 character tagline.'
      return
    }
    busy = true
    try {
      const res = await fetch('/api/riot-accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          riotId: altName.trim(),
          riotTag: altTag.trim(),
          label: altLabel.trim(),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        errorMessage = body?.message ?? `Failed to add account (${res.status}).`
        return
      }
      altName = ''
      altTag = ''
      altLabel = ''
      addingAlt = false
      await invalidateAll()
    } finally {
      busy = false
    }
  }

  async function removeAlt(id: string) {
    if (!window.confirm('Remove this linked account?')) return
    busy = true
    try {
      const res = await fetch(`/api/riot-accounts?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (res.ok) await invalidateAll()
    } finally {
      busy = false
    }
  }
</script>

<section class="panel">
  <div class="panel-head">
    <span class="panel-title">Riot accounts</span>
    {#if canEdit && !addingAlt}
      <button type="button" class="link-btn" onclick={() => (addingAlt = true)}>
        <Plus size={13} /> Add account
      </button>
    {/if}
  </div>

  <!-- Chosen display name -->
  <div class="row">
    <div class="row-main">
      <span class="row-label">Display name</span>
      {#if editingName && canEdit}
        <form
          method="POST"
          action="?/setDisplayName"
          class="name-form"
          use:enhance={() => {
            return async ({ update }) => {
              await update()
              editingName = false
            }
          }}
        >
          <input
            name="display_name"
            value={displayName ?? ''}
            class="input"
            maxlength="40"
            placeholder="Your name"
          />
          <button type="submit" class="save-btn">Save</button>
          <button type="button" class="cancel-btn" onclick={() => (editingName = false)}
            >Cancel</button
          >
        </form>
      {:else}
        <span class="row-value">{displayName ?? '—'}</span>
      {/if}
    </div>
    {#if canEdit && !editingName}
      <button
        type="button"
        class="icon-btn"
        aria-label="Edit display name"
        onclick={() => (editingName = true)}
      >
        <Pencil size={13} />
      </button>
    {/if}
  </div>

  <!-- Primary account -->
  {#if primary}
    <div class="row">
      <div class="row-main">
        <span class="row-label"><Star size={11} /> Primary Riot ID</span>
        <span class="row-value">
          {primary.riot_name}{#if primary.riot_tag}<span class="tag">#{primary.riot_tag}</span>{/if}
        </span>
      </div>
    </div>
  {/if}

  <!-- Alternate accounts -->
  {#each alts as alt (alt.id)}
    <div class="row">
      <div class="row-main">
        <span class="row-value">
          {alt.riot_name}{#if alt.riot_tag}<span class="tag">#{alt.riot_tag}</span>{/if}
          {#if alt.label}<span class="alt-label">{alt.label}</span>{/if}
        </span>
        <span class="status-pill" style={statusStyle[alt.status] ?? ''}>{alt.status}</span>
      </div>
      {#if canEdit}
        <button
          type="button"
          class="icon-btn"
          aria-label="Remove account"
          onclick={() => removeAlt(alt.id)}
          disabled={busy}
        >
          <X size={13} />
        </button>
      {/if}
    </div>
  {/each}

  {#if canEdit && addingAlt}
    <div class="add-form">
      <div class="add-inputs">
        <input bind:value={altName} class="input" placeholder="Alt Riot name" maxlength="24" />
        <span class="hash">#</span>
        <input bind:value={altTag} class="input input-tag" placeholder="NA1" maxlength="5" />
        <input bind:value={altLabel} class="input" placeholder="Label (optional)" maxlength="40" />
      </div>
      {#if errorMessage}<div class="error">{errorMessage}</div>{/if}
      <div class="add-actions">
        <span class="hint">Verified against Riot. An admin approves it before its stats merge.</span
        >
        <div class="add-buttons">
          <button
            type="button"
            class="cancel-btn"
            onclick={() => (addingAlt = false)}
            disabled={busy}>Cancel</button
          >
          <button type="button" class="save-btn" onclick={addAlt} disabled={busy}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>

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
    justify-content: space-between;
    margin-bottom: 0.625rem;
  }
  .panel-title {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.6);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.4375rem 0;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
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
  .row-label {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
    min-width: 6.5rem;
  }
  .row-value {
    font-size: 0.875rem;
    color: var(--text);
    word-break: break-word;
  }
  .tag {
    color: rgba(255, 255, 255, 0.5);
  }
  .alt-label {
    margin-left: 0.375rem;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.55);
    background: rgba(255, 255, 255, 0.06);
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
  }
  .status-pill {
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.125rem 0.4375rem;
    border-radius: 9999px;
  }
  .link-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: none;
    border: none;
    padding: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent-text, #93c5fd);
    cursor: pointer;
  }
  .link-btn:hover {
    text-decoration: underline;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.625rem;
    height: 1.625rem;
    flex-shrink: 0;
    border: none;
    border-radius: 0.375rem;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.12);
  }
  .name-form,
  .add-inputs {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-wrap: wrap;
  }
  .input {
    padding: 0.375rem 0.5rem;
    border-radius: 0.375rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(0, 0, 0, 0.28);
    color: var(--text);
    font-size: 0.8125rem;
  }
  .input-tag {
    max-width: 4.5rem;
    text-transform: uppercase;
  }
  .hash {
    color: rgba(255, 255, 255, 0.5);
  }
  .save-btn {
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    border: none;
    background: rgba(74, 222, 128, 0.2);
    color: #4ade80;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
  }
  .cancel-btn {
    padding: 0.375rem 0.625rem;
    border-radius: 0.375rem;
    border: none;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.65);
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .add-form {
    margin-top: 0.5rem;
    padding-top: 0.625rem;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  .add-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 0.5rem;
    flex-wrap: wrap;
  }
  .add-buttons {
    display: flex;
    gap: 0.375rem;
  }
  .hint {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.5);
  }
  .error {
    margin-top: 0.375rem;
    font-size: 0.75rem;
    color: #fca5a5;
  }
</style>
