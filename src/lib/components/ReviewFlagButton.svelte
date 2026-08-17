<script lang="ts">
  import { Flag } from 'lucide-svelte'

  interface Props {
    /** What is being flagged. */
    entityType: 'match' | 'player'
    /** The match id, or the player's profile id. */
    entityId: string
    /** Null when signed out — the button prompts the viewer to sign in. */
    viewerId: string | null
    /** Wording for the confirmation notice, e.g. "match" or "profile". */
    noun?: string
  }

  let { entityType, entityId, viewerId, noun = 'page' }: Props = $props()

  let busy = $state(false)
  let notice = $state<string | null>(null)
  let noticeKind = $state<'ok' | 'error'>('ok')

  async function flag() {
    if (busy) return
    if (!viewerId) {
      notice = 'Please sign in to report incorrect data.'
      noticeKind = 'error'
      return
    }

    const reason = window.prompt(
      `What looks wrong with this ${noun}? Describe it so an admin can fix it.`
    )
    // A null return means the viewer cancelled the prompt.
    if (reason === null) return
    if (reason.trim().length < 5) {
      notice = 'Please add a short description of what is wrong.'
      noticeKind = 'error'
      return
    }

    busy = true
    notice = null
    try {
      const response = await fetch('/api/review-flags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityType, entityId, reason }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message ?? 'Something went wrong')

      noticeKind = 'ok'
      notice = payload.alreadyReported
        ? 'You already flagged this — an admin will take a look.'
        : 'Thanks! Flagged for admin review.'
    } catch (err) {
      noticeKind = 'error'
      notice = err instanceof Error ? err.message : 'Something went wrong'
    } finally {
      busy = false
    }
  }
</script>

<div class="review-flag">
  <button type="button" class="review-flag-btn" disabled={busy} onclick={flag}>
    <Flag size={13} />
    {busy ? 'Reporting…' : 'Report incorrect data'}
  </button>
  {#if notice}
    <span class="review-flag-notice" class:is-error={noticeKind === 'error'}>{notice}</span>
  {/if}
</div>

<style>
  .review-flag {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .review-flag-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.6rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.6);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.4rem;
    cursor: pointer;
    transition:
      color 0.15s ease,
      border-color 0.15s ease,
      background 0.15s ease;
  }

  .review-flag-btn:hover:not(:disabled) {
    color: #fca5a5;
    border-color: rgba(248, 113, 113, 0.4);
    background: rgba(248, 113, 113, 0.08);
  }

  .review-flag-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .review-flag-notice {
    font-size: 0.78rem;
    color: #86efac;
  }

  .review-flag-notice.is-error {
    color: #fca5a5;
  }
</style>
