<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import { ClipboardList, Plus, X, Lock, Info } from 'lucide-svelte'
  import DiscordIcon from '$lib/components/icons/DiscordIcon.svelte'
  import { enhance } from '$app/forms'
  import { untrack } from 'svelte'

  let { data, form }: PageProps = $props()

  const signup = $derived(data.signup)
  const activeSeason = $derived(data.activeSeason)
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
    riotId: data.signup?.display_name ?? data.profile.riot_id_base ?? '',
    riotTag: data.signup?.riot_tag ?? data.profile.riot_tag ?? '',
    discordHandle: data.signup?.discord_handle ?? data.profile.discord_handle ?? '',
    trackerLinks: ((data.signup?.tracker_links as LinkRow[] | undefined)?.length
      ? [...(data.signup!.tracker_links as LinkRow[])]
      : [{ label: '', url: '' }]) as LinkRow[],
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

  const statusStyle: Record<string, string> = {
    pending: 'background: rgba(251,191,36,0.16); color: #fcd34d;',
    approved: 'background: rgba(74,222,128,0.16); color: #86efac;',
    rejected: 'background: rgba(248,113,113,0.16); color: #fca5a5;',
  }

  const statusCopy: Record<string, string> = {
    pending: 'Waiting for an admin to review your details.',
    approved: 'You are registered for this season.',
    rejected: 'An admin could not approve this. See their note below.',
  }
</script>

<svelte:head><title>Player Signup</title></svelte:head>

<PageContainer>
  <div class="page-content-narrow py-6">
    <PageHeading
      title="Player Signup"
      subtitle={activeSeason
        ? `Registering for ${activeSeason.name}`
        : 'Registration is currently closed'}
      icon={ClipboardList}
    />

    {#if !activeSeason}
      <div class="notice notice-warn">
        There is no active season right now, so signups are closed. Check back when the next season
        opens.
      </div>
    {:else}
      <!-- Current status -->
      {#if signup}
        <div class="status-card" class:status-card-approved={isApproved}>
          <div class="status-head">
            <span class="status-pill" style={statusStyle[signup.status] ?? ''}>
              {signup.status}
            </span>
            <span class="status-copy">{statusCopy[signup.status] ?? ''}</span>
          </div>

          {#if isApproved}
            <div class="assigned">
              <span class="assigned-label">Assigned value</span>
              <span class="assigned-value">
                {signup.manual_value_override ?? signup.computed_value ?? 'Not yet set'}
              </span>
            </div>
          {/if}

          {#if signup.admin_notes}
            <div class="admin-note">
              <Info size={14} style="flex-shrink: 0; margin-top: 1px;" />
              <span>{signup.admin_notes}</span>
            </div>
          {/if}
        </div>
      {/if}

      {#if form?.success}
        <div class="notice notice-success">{form.message}</div>
      {:else if form?.message}
        <div class="notice notice-error">{form.message}</div>
      {/if}

      {#if isLocked}
        <div class="locked-panel">
          <Lock size={18} style="color: rgba(255,255,255,0.6); flex-shrink: 0;" />
          <div>
            <div class="locked-title">Your signup is locked</div>
            <p class="locked-text">
              Approved signups can't be edited or withdrawn. Message an admin if your Riot ID,
              Discord, or tracker links need updating.
            </p>
          </div>
        </div>

        <!-- Read-only summary -->
        <section class="form-section">
          <h2 class="section-title">Submitted details</h2>
          <dl class="summary">
            <dt>Riot ID</dt>
            <dd>
              {#if signup?.display_name}
                {signup.display_name}{#if signup.riot_tag}<span class="summary-tag"
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
                <div class="summary-links">
                  {#each signup?.tracker_links ?? [] as link (link.url)}
                    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
                    <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>
                  {/each}
                </div>
              {:else}
                —
              {/if}
            </dd>
          </dl>
        </section>
      {:else}
        <form
          method="POST"
          action="?/submit"
          class="signup-form"
          use:enhance={() => {
            submitting = true
            return async ({ update }) => {
              await update()
              submitting = false
            }
          }}
        >
          <section class="form-section">
            <h2 class="section-title">Who you are</h2>

            <div class="field">
              <span class="field-label">Riot ID <span class="required">*</span></span>
              <div class="riot-id-row">
                <input
                  name="riotId"
                  bind:value={riotId}
                  class="input"
                  placeholder="YourName"
                  required
                  minlength="3"
                  maxlength="24"
                  disabled={submitting}
                  aria-label="Riot ID name"
                />
                <span class="riot-hash">#</span>
                <input
                  name="riotTag"
                  bind:value={riotTag}
                  class="input input-tag"
                  placeholder="NA1"
                  required
                  minlength="3"
                  maxlength="5"
                  disabled={submitting}
                  aria-label="Riot ID tagline"
                />
              </div>
              <span class="field-hint">
                Both parts of your in-game Riot ID. This is your identity across rosters, stats, and
                match pages, and is what an admin uses to look up your rank.
              </span>
            </div>

            <label class="field">
              <span class="field-label">Discord <span class="required">*</span></span>
              <input
                name="discordHandle"
                bind:value={discordHandle}
                class="input"
                placeholder="yourname"
                required
                maxlength="64"
                disabled={submitting}
              />
              <span class="field-hint">
                {#if data.profile.discord_handle && !data.signup}
                  Filled in from your Discord login — edit it if you use a different handle.
                {:else}
                  Shown on your player profile once approved, so captains can reach you.
                {/if}
              </span>
            </label>
          </section>

          <section class="form-section">
            <h2 class="section-title">Tracker links <span class="required">*</span></h2>
            <p class="section-intro">
              An admin uses these to verify your rank and set your rating. Add at least one.
            </p>

            <div class="links">
              {#each trackerLinks as link, index (index)}
                <div class="link-row">
                  <input
                    name="trackerUrl"
                    bind:value={link.url}
                    class="input"
                    placeholder="https://tracker.gg/valorant/profile/..."
                    type="url"
                    disabled={submitting}
                  />
                  {#if trackerLinks.length > 1}
                    <button
                      type="button"
                      class="link-remove"
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
              <button type="button" class="add-link" onclick={addLink}>
                <Plus size={13} /> Add another link
              </button>
            {/if}
          </section>

          <div class="rating-note">
            <Info
              size={14}
              style="flex-shrink: 0; margin-top: 2px; color: rgba(255,255,255,0.6);"
            />
            <p>
              Your rank and rating are set by an admin after reviewing your tracker — you don't
              enter them yourself. {#if signup}Editing your signup sends it back for review.{/if}
            </p>
          </div>

          <div class="form-actions">
            {#if signup}
              <button
                type="submit"
                form="withdraw-form"
                class="withdraw-btn"
                disabled={withdrawing || submitting}
              >
                {withdrawing ? 'Withdrawing...' : 'Withdraw signup'}
              </button>
            {/if}
            {#if signedIn}
              <button type="submit" class="submit-btn" disabled={submitting || !canSubmit}>
                {submitting ? 'Saving...' : signup ? 'Update signup' : 'Submit signup'}
              </button>
            {:else}
              <button type="button" class="submit-btn" onclick={() => (signInPromptOpen = true)}>
                Sign in to submit
              </button>
            {/if}
          </div>
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
    {/if}
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
        {#if activeSeason}
          Registering for {activeSeason.name} needs an account, so admins can reach you about your rank
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

<style>
  .signup-form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .form-section {
    padding: 1.25rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.2);
  }

  .section-title {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.64);
    margin-bottom: 0.875rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .section-intro {
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.55);
    line-height: 1.5;
    margin-bottom: 0.875rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3125rem;
  }

  .field + .field {
    margin-top: 0.875rem;
  }

  .field-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.75);
  }

  .required {
    color: #f87171;
  }

  .input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.28);
    color: var(--text);
    font-size: 0.875rem;
  }

  .input::placeholder {
    color: rgba(255, 255, 255, 0.52);
  }

  .input:focus {
    outline: none;
    border-color: var(--hover);
  }

  .input:disabled {
    opacity: 0.6;
  }

  .field-hint {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.6);
    line-height: 1.45;
  }

  /* Name and tagline read as one field, split by a literal '#'. */
  .riot-id-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .riot-hash {
    color: rgba(255, 255, 255, 0.56);
    font-size: 0.9375rem;
    flex-shrink: 0;
  }

  .input-tag {
    max-width: 6rem;
    flex-shrink: 0;
    text-transform: uppercase;
  }

  /* Tracker links */
  .links {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .link-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .link-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.875rem;
    height: 1.875rem;
    flex-shrink: 0;
    border-radius: 0.375rem;
    border: none;
    background: rgba(248, 113, 113, 0.12);
    color: #f87171;
    cursor: pointer;
  }

  .link-remove:hover {
    background: rgba(248, 113, 113, 0.22);
  }

  .add-link {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    margin-top: 0.625rem;
    background: none;
    border: none;
    padding: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent-text);
    cursor: pointer;
  }

  .add-link:hover {
    text-decoration: underline;
  }

  /* Status */
  .status-card {
    padding: 0.875rem 1rem;
    border-radius: 0.625rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.07);
    margin-bottom: 0.75rem;
  }

  .status-card-approved {
    border-color: rgba(74, 222, 128, 0.28);
    background: rgba(74, 222, 128, 0.05);
  }

  .status-head {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-wrap: wrap;
  }

  .status-pill {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.1875rem 0.4375rem;
    border-radius: 9999px;
  }

  .status-copy {
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.62);
  }

  .assigned {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    flex-wrap: wrap;
  }

  .assigned-label {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.62);
  }

  .assigned-value {
    font-size: 1.375rem;
    font-weight: 700;
    color: #d8b4fe;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .admin-note {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    font-size: 0.8125rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.7);
  }

  /* Locked */
  .locked-panel {
    display: flex;
    gap: 0.75rem;
    padding: 0.875rem 1rem;
    border-radius: 0.625rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    margin-bottom: 1.25rem;
  }

  .locked-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text);
  }

  .locked-text {
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.55);
    line-height: 1.5;
    margin-top: 0.1875rem;
  }

  .summary {
    display: grid;
    grid-template-columns: 7rem 1fr;
    gap: 0.5rem 1rem;
    font-size: 0.8125rem;
  }

  .summary dt {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.64);
  }

  .summary dd {
    color: rgba(255, 255, 255, 0.8);
    word-break: break-word;
  }

  .summary-tag {
    color: rgba(255, 255, 255, 0.64);
  }

  .summary-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .summary-links a {
    color: #93c5fd;
    text-decoration: none;
  }

  .summary-links a:hover {
    text-decoration: underline;
  }

  /* Notices */
  .rating-note {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 0.75rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.5);
  }

  .notice {
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    font-size: 0.8125rem;
    line-height: 1.5;
    margin-bottom: 0.75rem;
  }

  .notice-success {
    background: rgba(74, 222, 128, 0.1);
    border: 1px solid rgba(74, 222, 128, 0.3);
    color: #bbf7d0;
  }

  .notice-error {
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.3);
    color: #fecaca;
  }

  .notice-warn {
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.28);
    color: #fde68a;
  }

  /* Actions */
  .form-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.75rem;
  }

  .submit-btn {
    padding: 0.625rem 1.75rem;
    border-radius: 0.5rem;
    border: none;
    background: var(--accent);
    color: var(--text);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .submit-btn:hover:not(:disabled) {
    background: var(--hover);
  }

  .submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .withdraw-btn {
    margin-right: auto;
    padding: 0.625rem 1rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(248, 113, 113, 0.25);
    background: transparent;
    color: #f87171;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .withdraw-btn:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.12);
  }

  .withdraw-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Sign-in prompt */
  .prompt-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.25rem;
    background: rgba(0, 0, 0, 0.66);
    backdrop-filter: blur(3px);
  }

  .prompt-card {
    position: relative;
    width: 100%;
    max-width: 24rem;
    padding: 1.75rem 1.5rem 1.375rem;
    border-radius: 0.875rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: #2e1a4d;
    text-align: center;
    box-shadow: 0 1.5rem 3rem rgba(0, 0, 0, 0.45);
  }

  .prompt-close {
    position: absolute;
    top: 0.625rem;
    right: 0.625rem;
    display: flex;
    padding: 0.3125rem;
    border: none;
    border-radius: 0.375rem;
    background: none;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
  }

  .prompt-close:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text);
  }

  .prompt-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    margin-bottom: 0.875rem;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.07);
    color: var(--accent-text);
  }

  .prompt-title {
    font-size: 1.0625rem;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 0.5rem;
  }

  .prompt-text {
    font-size: 0.8125rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.66);
    margin-bottom: 1.25rem;
  }

  .prompt-action {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.625rem 1rem;
    border-radius: 0.5rem;
    background: #5865f2;
    color: #fff;
    font-size: 0.875rem;
    font-weight: 600;
    text-decoration: none;
  }

  .prompt-action:hover {
    background: #4752c4;
  }

  .prompt-dismiss {
    margin-top: 0.75rem;
    background: none;
    border: none;
    padding: 0;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
  }

  .prompt-dismiss:hover {
    color: rgba(255, 255, 255, 0.75);
  }

  @media (max-width: 640px) {
    .form-section {
      padding: 0.875rem;
    }

    .summary {
      grid-template-columns: 1fr;
      gap: 0.125rem 0;
    }

    .summary dd {
      margin-bottom: 0.5rem;
    }

    .form-actions {
      flex-direction: column-reverse;
      align-items: stretch;
    }

    .withdraw-btn {
      margin-right: 0;
    }
  }
</style>
