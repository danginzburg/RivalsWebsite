<script lang="ts">
  import { enhance } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import { onMount } from 'svelte'
  import { Plus, X, Star, Pencil, ExternalLink, ChevronDown } from 'lucide-svelte'
  import DiscordIcon from '$lib/components/icons/DiscordIcon.svelte'
  import { trackerProfileUrl } from '$lib/players/tracker-url'

  type RiotAccount = {
    id: string
    riot_name: string
    riot_tag: string
    riot_puuid: string | null
    is_primary: boolean
    status: 'pending' | 'approved' | 'rejected'
    label: string | null
    /** `identity`: an admin link from the identities tab with no account row. */
    source?: 'account' | 'identity'
  }

  let {
    accounts = [],
    canEdit = false,
    displayName = null,
    discordHandle = null,
    variant = 'card',
  }: {
    accounts?: RiotAccount[]
    canEdit?: boolean
    displayName?: string | null
    discordHandle?: string | null
    /** 'flush' is a collapsible row of a page sheet instead of a boxed panel. */
    variant?: 'card' | 'flush'
  } = $props()

  const primary = $derived(accounts.find((a) => a.is_primary) ?? null)
  const alts = $derived(accounts.filter((a) => !a.is_primary))

  const trackerUrl = $derived(trackerProfileUrl(primary?.riot_name, primary?.riot_tag))

  const EXPANDED_STORAGE_KEY = 'profile-player-info-expanded'

  // As a sheet row it starts collapsed (the summary shows the primary Riot ID);
  // a stored choice wins either way.
  // svelte-ignore state_referenced_locally
  let expanded = $state(variant !== 'flush')

  onMount(() => {
    try {
      const stored = localStorage.getItem(EXPANDED_STORAGE_KEY)
      if (stored === 'false') expanded = false
      else if (stored === 'true') expanded = true
    } catch {
      // storage unavailable — stay expanded
    }
  })

  function setExpanded(value: boolean) {
    expanded = value
    try {
      localStorage.setItem(EXPANDED_STORAGE_KEY, String(value))
    } catch {
      // ignore
    }
  }

  let editingName = $state(false)
  let addingAlt = $state(false)
  let altName = $state('')
  let altTag = $state('')
  let altLabel = $state('')
  let busy = $state(false)
  let errorMessage = $state<string | null>(null)

  const statusStyle: Record<string, string> = {
    pending: 'background: rgba(251,191,36,0.16); color: var(--gold);',
    approved: 'background: rgba(74,222,128,0.16); color: var(--good-text);',
    rejected: 'background: rgba(248,113,113,0.16); color: var(--bad-text);',
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

{#snippet linkedMark()}
  <span class="linked-mark" title="Linked by Riot account ID, so stats follow it through renames"
    >Linked</span
  >
{/snippet}

<section class="panel" class:open={expanded} class:panel-flush={variant === 'flush'}>
  <div class="panel-head">
    <button
      type="button"
      class="panel-toggle"
      aria-expanded={expanded}
      onclick={() => setExpanded(!expanded)}
    >
      <span class="panel-title">Player info</span>
      {#if variant === 'flush' && !expanded && primary}
        <span class="panel-summary">
          {primary.riot_name}{#if primary.riot_tag}<span class="tag">#{primary.riot_tag}</span>{/if}
          {#if alts.length > 0}
            <span class="panel-summary-dim"
              >· +{alts.length} account{alts.length === 1 ? '' : 's'}</span
            >
          {/if}
        </span>
      {/if}
      <ChevronDown size={14} class="chevron" />
    </button>
    {#if canEdit && !addingAlt}
      <button
        type="button"
        class="link-btn"
        onclick={() => {
          setExpanded(true)
          addingAlt = true
        }}
      >
        <Plus size={13} /> Add account
      </button>
    {/if}
  </div>

  {#if expanded}
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
            {primary.riot_name}{#if primary.riot_tag}<span class="tag">#{primary.riot_tag}</span
              >{/if}
          </span>
          {#if primary.riot_puuid}{@render linkedMark()}{/if}
        </div>
        {#if trackerUrl}
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a href={trackerUrl} target="_blank" rel="noopener noreferrer" class="tracker-link">
            <ExternalLink size={12} />
            Tracker
          </a>
        {/if}
      </div>
    {/if}

    {#if discordHandle}
      <div class="row">
        <div class="row-main">
          <span class="row-label"><DiscordIcon size={11} /> Discord</span>
          <span class="row-value">{discordHandle}</span>
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
          {#if alt.riot_puuid}{@render linkedMark()}{/if}
          {#if alt.status !== 'approved'}
            <span class="status-pill" style={statusStyle[alt.status] ?? ''}>{alt.status}</span>
          {/if}
        </div>
        {#if canEdit && alt.source !== 'identity'}
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
          <input
            bind:value={altLabel}
            class="input"
            placeholder="Label (optional)"
            maxlength="40"
          />
        </div>
        {#if errorMessage}<div class="error">{errorMessage}</div>{/if}
        <div class="add-actions">
          <span class="hint"
            >Verified against Riot. An admin approves it before its stats merge.</span
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
  {/if}
</section>

<style src="./RiotAccountsPanel.css"></style>
