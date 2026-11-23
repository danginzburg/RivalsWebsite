<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { ClipboardList, Plus, X, Lock, Info, Eye, Search } from 'lucide-svelte'
  import { resolve } from '$app/paths'
  import DiscordIcon from '$lib/components/icons/DiscordIcon.svelte'
  import { enhance } from '$app/forms'
  import { untrack } from 'svelte'

  let { data, form }: PageProps = $props()

  const signup = $derived(data.signup)
  const signupSeason = $derived(data.signupSeason)
  const isApproved = $derived(data.signup?.status === 'approved')
  const isLocked = $derived(isApproved)

  /**
   * Signed-out visitors see the real form behind a prompt rather than being
   * redirected away, so they can tell what they are being asked to sign in for.
   * Dismissing it leaves the form inert — the server rejects the post anyway.
   */
  const signedIn = $derived(data.signedIn !== false)
  let signInPromptOpen = $state(false)

  $effect(() => {
    if (!signedIn) signInPromptOpen = true
  })

  type LinkRow = { label: string; url: string }

  /**
   * Seed the form once from an existing signup. These are a snapshot: while the
   * form is open the fields belong to the user, not to later load data.
   */
  const seed = untrack(() => ({
    // Prefill from the existing signup, then fall back to the profile so a
    // returning player does not retype details the site already knows.
    riotId: data.signup?.display_name ?? data.profile.riot_name ?? '',
    riotTag: data.signup?.riot_tag ?? data.profile.riot_tag ?? '',
    discordHandle: data.signup?.discord_handle ?? data.profile.discord_handle ?? '',
    trackerLinks: ((data.signup?.tracker_links as LinkRow[] | undefined)?.length
      ? [...(data.signup!.tracker_links as LinkRow[])]
      : [{ label: '', url: data.profile.tracker_url ?? '' }]) as LinkRow[],
  }))

  let riotId = $state(seed.riotId)
  let riotTag = $state(seed.riotTag)
  let discordHandle = $state(seed.discordHandle)
  let trackerLinks = $state<LinkRow[]>(seed.trackerLinks)

  let submitting = $state(false)
  let withdrawing = $state(false)

  const canSubmit = $derived(
    riotId.trim().length >= 3 &&
      /^[A-Za-z0-9]{3,5}$/.test(riotTag.trim()) &&
      // Stripped of a leading @, the same way the server normalises it.
      discordHandle.trim().replace(/^@+/, '').length > 0 &&
      trackerLinks.some((l) => l.url.trim().length > 0)
  )

  function addLink() {
    if (trackerLinks.length >= data.maxTrackerLinks) return
    trackerLinks = [...trackerLinks, { label: '', url: '' }]
  }

  function removeLink(index: number) {
    trackerLinks = trackerLinks.filter((_, i) => i !== index)
    if (trackerLinks.length === 0) trackerLinks = [{ label: '', url: '' }]
  }

  /** Approved players' ratings; admin-only until the first signup is approved. */
  const ratings = $derived(data.ratings)
  let previewOpen = $state(false)
  let ratingsQuery = $state('')
  const ratingRows = $derived.by(() => {
    const rows = (ratings?.rows ?? []).map((row, i) => ({ ...row, place: i + 1 }))
    const q = ratingsQuery.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) => r.riotId?.toLowerCase().includes(q) || r.discord?.toLowerCase().includes(q)
    )
  })

  const statusCopy: Record<string, string> = {
    pending: 'Waiting for an admin to review your details.',
    approved: 'You are registered for this season.',
    rejected: 'An admin could not approve this. See their note below.',
  }
</script>

<svelte:head><title>Player Signup</title></svelte:head>

<PageContainer>
  <div class="page-content-narrow py-6">
    <div class="sheet">
      <header class="su-head">
        <div class="su-head-text">
          <h1 class="su-title">Player Signup</h1>
          <p class="su-sub">
            {signupSeason
              ? `Registering for ${signupSeason.name}`
              : 'Registration is currently closed'}
          </p>
        </div>
        {#if signupSeason && signup}
          <span class="su-pill su-pill-{signup.status}">{signup.status}</span>
        {/if}
      </header>

      {#if !signupSeason}
        <div class="su-closed">
          <ClipboardList size={22} class="su-closed-icon" />
          <p class="su-closed-title">Signups are closed</p>
          <p class="su-closed-text">Check back when the next season opens.</p>
        </div>
      {:else}
        <!-- Current status -->
        {#if signup}
          <section class="su-status" class:su-status-approved={isApproved}>
            <p class="su-status-copy">{statusCopy[signup.status] ?? ''}</p>

            {#if isApproved}
              <div class="su-assigned">
                <span class="su-assigned-label">Assigned value</span>
                <span class="su-assigned-value">{signup.assigned_value ?? 'Not yet set'}</span>
              </div>
            {/if}

            {#if signup.admin_notes}
              <div class="su-admin-note">
                <Info size={14} class="su-inline-icon" />
                <span>{signup.admin_notes}</span>
              </div>
            {/if}
          </section>
        {/if}

        {#if form?.success}
          <div class="su-banner su-banner-success">{form.message}</div>
        {:else if form?.message}
          <div class="su-banner su-banner-error">{form.message}</div>
        {/if}

        {#if isLocked}
          <div class="su-banner su-banner-locked">
            <Lock size={15} class="su-inline-icon" />
            <div>
              <strong>Your signup is locked.</strong>
              Approved signups can't be edited or withdrawn. Message an admin if your Riot ID, Discord,
              or tracker links need updating.
            </div>
          </div>

          <!-- Read-only summary -->
          <section class="sheet-section">
            <div class="sheet-head"><h2 class="sheet-title">Submitted details</h2></div>
            <div class="sheet-body">
              <dl class="su-summary">
                <dt>Riot ID</dt>
                <dd>
                  {#if signup?.display_name}
                    {signup.display_name}{#if signup.riot_tag}<span class="su-summary-tag"
                        >#{signup.riot_tag}</span
                      >{/if}
                  {:else}
                    —
                  {/if}
                </dd>
                <dt>Discord</dt>
                <dd>{signup?.discord_handle ?? '—'}</dd>
                <dt>Trackers</dt>
                <dd>
                  {#if (signup?.tracker_links ?? []).length > 0}
                    <div class="su-summary-links">
                      {#each signup?.tracker_links ?? [] as link (link.url)}
                        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
                        <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a
                        >
                      {/each}
                    </div>
                  {:else}
                    —
                  {/if}
                </dd>
              </dl>
            </div>
          </section>
        {:else}
          <form
            method="POST"
            action="?/submit"
            use:enhance={() => {
              submitting = true
              return async ({ update }) => {
                await update()
                submitting = false
              }
            }}
          >
            <section class="sheet-section">
              <div class="sheet-head"><h2 class="sheet-title">Who you are</h2></div>
              <div class="sheet-body su-fields">
                <div class="su-field">
                  <span class="su-label">Riot ID <span class="su-required">*</span></span>
                  <div class="su-riot-row">
                    <input
                      name="riotId"
                      bind:value={riotId}
                      class="su-input"
                      placeholder="YourName"
                      required
                      minlength="3"
                      maxlength="24"
                      disabled={submitting}
                      aria-label="Riot ID name"
                    />
                    <span class="su-hash">#</span>
                    <input
                      name="riotTag"
                      bind:value={riotTag}
                      class="su-input su-input-tag"
                      placeholder="NA1"
                      required
                      minlength="3"
                      maxlength="5"
                      disabled={submitting}
                      aria-label="Riot ID tagline"
                    />
                  </div>
                  <span class="su-hint">
                    Both parts of your in-game Riot ID. This is your identity across rosters, stats,
                    and match pages, and is what an admin uses to look up your rank.
                  </span>
                </div>

                <label class="su-field">
                  <span class="su-label">Discord <span class="su-required">*</span></span>
                  <input
                    name="discordHandle"
                    bind:value={discordHandle}
                    class="su-input"
                    placeholder="yourname"
                    required
                    maxlength="64"
                    disabled={submitting}
                  />
                  <span class="su-hint">
                    {#if data.profile.discord_handle && !data.signup}
                      Filled in from your Discord login — edit it if you use a different handle.
                    {:else}
                      Shown on your player profile once approved, so captains can reach you.
                    {/if}
                  </span>
                </label>
              </div>
            </section>

            <section class="sheet-section">
              <div class="sheet-head">
                <h2 class="sheet-title">Tracker links <span class="su-required">*</span></h2>
              </div>
              <div class="sheet-body">
                <p class="su-intro">
                  An admin uses these to verify your rank and set your rating. Add at least one.
                  {#if data.profile.tracker_url && !data.signup}
                    Your profile's tracker is filled in — add any alt accounts below.
                  {/if}
                </p>

                <div class="su-links">
                  {#each trackerLinks as link, index (index)}
                    <div class="su-link-row">
                      <input
                        name="trackerUrl"
                        bind:value={link.url}
                        class="su-input"
                        placeholder="https://tracker.gg/valorant/profile/..."
                        type="url"
                        aria-label="Tracker link {index + 1}"
                        disabled={submitting}
                      />
                      {#if trackerLinks.length > 1}
                        <button
                          type="button"
                          class="su-link-remove"
                          aria-label="Remove link"
                          onclick={() => removeLink(index)}
                        >
                          <X size={14} />
                        </button>
                      {/if}
                    </div>
                  {/each}
                </div>

                {#if trackerLinks.length < data.maxTrackerLinks}
                  <button type="button" class="su-add-link" onclick={addLink}>
                    <Plus size={13} /> Add another link
                  </button>
                {/if}
              </div>
            </section>

            <footer class="su-foot">
              <p class="su-foot-note">
                <Info size={13} class="su-inline-icon" />
                <span>
                  Your rank and rating are set by an admin after reviewing your tracker — you don't
                  enter them yourself. {#if signup}Editing your signup sends it back for review.{/if}
                </span>
              </p>

              <div class="su-actions">
                {#if signup}
                  <button
                    type="submit"
                    form="withdraw-form"
                    class="su-withdraw"
                    disabled={withdrawing || submitting}
                  >
                    {withdrawing ? 'Withdrawing...' : 'Withdraw'}
                  </button>
                {/if}
                {#if signedIn}
                  <button type="submit" class="su-submit" disabled={submitting || !canSubmit}>
                    {submitting ? 'Saving...' : signup ? 'Update signup' : 'Submit signup'}
                  </button>
                {:else}
                  <button type="button" class="su-submit" onclick={() => (signInPromptOpen = true)}>
                    Sign in to submit
                  </button>
                {/if}
              </div>
            </footer>
          </form>

          {#if signup}
            <!-- Separate form so the withdraw button posts no signup fields. -->
            <form
              id="withdraw-form"
              method="POST"
              action="?/withdraw"
              use:enhance={() => {
                if (!window.confirm('Withdraw your signup for this season?')) {
                  return async () => {}
                }
                withdrawing = true
                return async ({ update }) => {
                  await update()
                  withdrawing = false
                }
              }}
            ></form>
          {/if}
        {/if}

        {#if ratings}
          <section class="sheet-section su-ratings">
            <div class="sheet-head">
              <h2 class="sheet-title">
                {ratings.preview ? 'Player ratings preview' : 'Approved players'}
              </h2>
              <span class="su-count">{ratings.rows.length}</span>
              {#if ratings.preview}
                <span class="sheet-note">Admins only until the first signup is approved</span>
                <button
                  type="button"
                  class="su-preview-toggle"
                  aria-expanded={previewOpen}
                  onclick={() => (previewOpen = !previewOpen)}
                >
                  <Eye size={13} />
                  {previewOpen ? 'Hide' : 'Show'}
                </button>
              {/if}
            </div>

            {#if !ratings.preview || previewOpen}
              <div class="sheet-body">
                {#if ratings.rows.length === 0}
                  <p class="su-intro">No approved signups yet.</p>
                {:else}
                  <div class="su-search-wrap">
                    <Search size={14} class="su-search-icon" />
                    <input
                      class="su-input su-search"
                      type="search"
                      placeholder="Search Riot ID or Discord"
                      aria-label="Search player ratings"
                      bind:value={ratingsQuery}
                    />
                  </div>
                  <div class="su-table-wrap">
                    <table class="su-table">
                      <thead>
                        <tr>
                          <th class="col-place">#</th>
                          <th>Player</th>
                          <th class="col-discord">Discord</th>
                          <th class="col-score">Rating</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each ratingRows as row (row.profileId)}
                          <tr>
                            <td class="col-place">{row.place}</td>
                            <td>
                              <a href={resolve(`/players/${row.profileId}`)} class="su-player">
                                {row.riotId ?? 'Unknown'}
                              </a>
                            </td>
                            <td class="col-discord">{row.discord ?? '—'}</td>
                            <td class="col-score">{row.score ?? '—'}</td>
                          </tr>
                        {:else}
                          <tr><td colspan="4" class="su-table-empty">No players match.</td></tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                {/if}
              </div>
            {/if}
          </section>
        {/if}
      {/if}
    </div>
  </div>
</PageContainer>

{#if !signedIn && signInPromptOpen}
  <div
    class="prompt-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="signin-prompt-title"
    tabindex="-1"
    onclick={(event) => {
      // Only a click on the backdrop itself dismisses — not one that bubbled
      // up from the card.
      if (event.target === event.currentTarget) signInPromptOpen = false
    }}
    onkeydown={(event) => {
      if (event.key === 'Escape') signInPromptOpen = false
    }}
  >
    <div class="prompt-card">
      <button
        type="button"
        class="prompt-close"
        aria-label="Close"
        onclick={() => (signInPromptOpen = false)}
      >
        <X size={16} />
      </button>

      <div class="prompt-icon"><ClipboardList size={22} /></div>
      <h2 class="prompt-title" id="signin-prompt-title">Sign in to sign up</h2>
      <p class="prompt-text">
        {#if signupSeason}
          Registering for {signupSeason.name} needs an account, so admins can reach you about your rank
          and roster. Signing in with Discord creates one.
        {:else}
          Signing up needs an account, so admins can reach you about your rank and roster. Signing
          in with Discord creates one.
        {/if}
      </p>

      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a class="prompt-action" href="/auth/login?returnTo=/signup">
        <DiscordIcon size={16} />
        Continue with Discord
      </a>

      <button type="button" class="prompt-dismiss" onclick={() => (signInPromptOpen = false)}>
        Have a look around first
      </button>
    </div>
  </div>
{/if}

<style src="./page.css"></style>
