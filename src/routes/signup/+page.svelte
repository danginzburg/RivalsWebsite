<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { ClipboardList, Plus, X } from 'lucide-svelte'
  import { enhance } from '$app/forms'
  import { untrack } from 'svelte'
  import {
    computeRatingFromRankNames,
    roundRating,
    SIGNUP_RANK_OPTIONS,
  } from '$lib/signups/formula'

  let { data, form }: PageProps = $props()

  const signup = $derived(data.signup)
  const activeSeason = $derived(data.activeSeason)

  type LinkRow = { label: string; url: string }

  /**
   * Seed the form once from an existing signup, falling back to profile values.
   * These are deliberately a snapshot — once the form is open, the fields belong
   * to the user, not to subsequent load data.
   */
  const seed = untrack(() => ({
    displayName:
      data.signup?.display_name ?? data.profile.riot_id_base ?? data.profile.display_name ?? '',
    discordHandle: data.signup?.discord_handle ?? '',
    currentRank: data.signup?.current_rank ?? '',
    peakRank: data.signup?.peak_rank ?? '',
    trackerCurrentScore:
      data.signup?.tracker_current_score != null ? String(data.signup.tracker_current_score) : '',
    trackerPeakScore:
      data.signup?.tracker_peak_score != null ? String(data.signup.tracker_peak_score) : '',
    trackerLinks: ((data.signup?.tracker_links as LinkRow[] | undefined)?.length
      ? [...(data.signup!.tracker_links as LinkRow[])]
      : [{ label: '', url: '' }]) as LinkRow[],
  }))

  let displayName = $state(seed.displayName)
  let discordHandle = $state(seed.discordHandle)
  let currentRank = $state(seed.currentRank)
  let peakRank = $state(seed.peakRank)
  let trackerCurrentScore = $state(seed.trackerCurrentScore)
  let trackerPeakScore = $state(seed.trackerPeakScore)
  let trackerLinks = $state<LinkRow[]>(seed.trackerLinks)

  let submitting = $state(false)

  /** Live preview so a player can see how their inputs move the number. */
  const preview = $derived(
    computeRatingFromRankNames({
      currentRank: currentRank || null,
      peakRank: peakRank || null,
      trackerCurrentScore: trackerCurrentScore === '' ? null : Number(trackerCurrentScore),
      trackerPeakScore: trackerPeakScore === '' ? null : Number(trackerPeakScore),
    })
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
      {#if signup}
        <div class="status-bar">
          <span class="status-label">Your signup</span>
          <span class="status-pill" style={statusStyle[signup.status] ?? ''}>{signup.status}</span>
          {#if signup.status === 'approved'}
            <span class="status-note">
              Assigned value:
              <strong>{signup.manual_value_override ?? signup.computed_value ?? '—'}</strong>
            </span>
          {/if}
        </div>
        {#if signup.admin_notes}
          <div class="notice notice-info">
            <strong>Note from an admin:</strong>
            {signup.admin_notes}
          </div>
        {/if}
      {/if}

      {#if form?.success}
        <div class="notice notice-success">{form.message}</div>
      {:else if form?.message}
        <div class="notice notice-error">{form.message}</div>
      {/if}

      <form
        method="POST"
        class="signup-form"
        use:enhance={() => {
          submitting = true
          return async ({ update }) => {
            await update()
            submitting = false
          }
        }}
      >
        <!-- Identity -->
        <section class="form-section">
          <h2 class="section-title">Who you are</h2>

          <label class="field">
            <span class="field-label">Display name <span class="required">*</span></span>
            <input
              name="displayName"
              bind:value={displayName}
              class="input"
              placeholder="The name you play under"
              required
              maxlength="48"
            />
            <span class="field-hint">
              This is how you'll appear on rosters, stats, and match pages.
            </span>
          </label>

          <label class="field">
            <span class="field-label">Discord</span>
            <input
              name="discordHandle"
              bind:value={discordHandle}
              class="input"
              placeholder="yourname"
              maxlength="64"
            />
            <span class="field-hint">
              Shown on your player profile so captains and teammates can reach you.
            </span>
          </label>
        </section>

        <!-- Ranks -->
        <section class="form-section">
          <h2 class="section-title">Your rank</h2>

          <div class="field-row">
            <label class="field">
              <span class="field-label">Current rank <span class="required">*</span></span>
              <CustomSelect
                options={SIGNUP_RANK_OPTIONS}
                value={currentRank}
                placeholder="Select current rank"
                onSelect={(value) => (currentRank = value)}
              />
              <input type="hidden" name="currentRank" value={currentRank} />
            </label>

            <label class="field">
              <span class="field-label">Peak rank</span>
              <CustomSelect
                options={SIGNUP_RANK_OPTIONS}
                value={peakRank}
                placeholder="Select peak rank"
                onSelect={(value) => (peakRank = value)}
              />
              <input type="hidden" name="peakRank" value={peakRank} />
            </label>
          </div>
        </section>

        <!-- Trackers -->
        <section class="form-section">
          <h2 class="section-title">Tracker</h2>

          <div class="links">
            {#each trackerLinks as link, index (index)}
              <div class="link-row">
                <input
                  name="trackerLabel"
                  bind:value={link.label}
                  class="input input-label"
                  placeholder="Label"
                  maxlength="60"
                />
                <input
                  name="trackerUrl"
                  bind:value={link.url}
                  class="input"
                  placeholder="https://tracker.gg/valorant/profile/..."
                  type="url"
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

          <div class="field-row score-row">
            <label class="field">
              <span class="field-label">Tracker current score</span>
              <input
                name="trackerCurrentScore"
                bind:value={trackerCurrentScore}
                class="input"
                type="number"
                step="any"
                min="0"
                placeholder="Leave blank if unknown"
              />
            </label>
            <label class="field">
              <span class="field-label">Tracker peak score</span>
              <input
                name="trackerPeakScore"
                bind:value={trackerPeakScore}
                class="input"
                type="number"
                step="any"
                min="0"
                placeholder="Leave blank if unknown"
              />
            </label>
          </div>
          <p class="field-hint">
            These are filled in automatically where possible. Enter them by hand if you know them.
          </p>
        </section>

        <!-- Live preview -->
        {#if currentRank}
          <section class="preview">
            <div class="preview-head">
              <span class="preview-label">Estimated value</span>
              <span class="preview-value">{roundRating(preview.rating)}</span>
            </div>
            <div class="preview-terms">
              <span>Current {preview.currentTerm.toFixed(2)}</span>
              <span>Peak {preview.peakTerm.toFixed(2)}</span>
              <span>√Tracker {preview.trackerCurrentTerm.toFixed(2)}</span>
              <span>ln(Peak) {preview.trackerPeakTerm.toFixed(2)}</span>
              <span>×{preview.multiplier.toFixed(3)}</span>
            </div>
            <p class="preview-note">An admin reviews this before it's final and may adjust it.</p>
          </section>
        {/if}

        <div class="form-actions">
          <button type="submit" class="submit-btn" disabled={submitting || !currentRank}>
            {submitting ? 'Submitting...' : signup ? 'Update Signup' : 'Submit Signup'}
          </button>
        </div>
      </form>
    {/if}
  </div>
</PageContainer>

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
    color: rgba(255, 255, 255, 0.45);
    margin-bottom: 0.875rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3125rem;
    flex: 1;
    min-width: 0;
  }

  .field + .field {
    margin-top: 0.875rem;
  }

  .field-row {
    display: flex;
    gap: 0.75rem;
  }

  .field-row .field + .field {
    margin-top: 0;
  }

  .score-row {
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
    color: rgba(255, 255, 255, 0.3);
  }

  .input:focus {
    outline: none;
    border-color: var(--hover);
  }

  .field-hint {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.4);
    line-height: 1.45;
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

  .input-label {
    max-width: 9rem;
    flex-shrink: 0;
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
    color: var(--hover);
    cursor: pointer;
  }

  .add-link:hover {
    text-decoration: underline;
  }

  /* Preview */
  .preview {
    padding: 1rem 1.25rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(120, 67, 145, 0.35);
    background: rgba(120, 67, 145, 0.08);
  }

  .preview-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }

  .preview-label {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.5);
  }

  .preview-value {
    font-size: 1.75rem;
    font-weight: 700;
    color: #d8b4fe;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .preview-terms {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 0.625rem;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.45);
    font-variant-numeric: tabular-nums;
  }

  .preview-note {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.38);
    margin-top: 0.5rem;
  }

  /* Status + notices */
  .status-bar {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-wrap: wrap;
    padding: 0.75rem 1rem;
    border-radius: 0.625rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.07);
    margin-bottom: 0.75rem;
  }

  .status-label {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.45);
  }

  .status-pill {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.1875rem 0.4375rem;
    border-radius: 9999px;
  }

  .status-note {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
    margin-left: auto;
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

  .notice-info {
    background: rgba(96, 165, 250, 0.08);
    border: 1px solid rgba(96, 165, 250, 0.25);
    color: #bfdbfe;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
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

  @media (max-width: 640px) {
    .form-section {
      padding: 0.875rem;
    }

    .field-row {
      flex-direction: column;
      gap: 0.875rem;
    }

    .link-row {
      flex-wrap: wrap;
    }

    .input-label {
      max-width: none;
    }
  }
</style>
