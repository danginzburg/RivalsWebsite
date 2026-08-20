<script lang="ts">
  import { Bug, X } from 'lucide-svelte'
  import { page } from '$app/stores'

  interface Props {
    /** Whether a viewer is signed in — bug reports require an account. */
    signedIn: boolean
  }

  let { signedIn }: Props = $props()

  let open = $state(false)
  let description = $state('')
  let busy = $state(false)
  let notice = $state<string | null>(null)
  let noticeKind = $state<'ok' | 'error'>('ok')
  let textarea = $state<HTMLTextAreaElement | null>(null)

  function openForm() {
    open = true
    notice = null
    // Focus the textarea once the panel is in the DOM.
    queueMicrotask(() => textarea?.focus())
  }

  function closeForm() {
    open = false
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeForm()
  }

  async function submit() {
    if (busy) return
    if (description.trim().length < 10) {
      notice = 'Please add a bit more detail so we can look into it.'
      noticeKind = 'error'
      return
    }

    busy = true
    notice = null
    try {
      const response = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description,
          // The route the user was on, so an admin can reproduce it.
          pagePath: $page.url.pathname + $page.url.search,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message ?? 'Something went wrong')

      noticeKind = 'ok'
      notice = 'Thanks! Your report was sent to the admins.'
      description = ''
      // Give the confirmation a moment to read, then close.
      setTimeout(() => {
        if (noticeKind === 'ok') closeForm()
      }, 1600)
    } catch (err) {
      noticeKind = 'error'
      notice = err instanceof Error ? err.message : 'Something went wrong'
    } finally {
      busy = false
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<button
  type="button"
  class="bug-fab"
  onclick={openForm}
  title="Report a bug"
  aria-label="Report a bug"
>
  <Bug size={18} />
  <span class="bug-fab-label">Report a bug</span>
</button>

{#if open}
  <!-- Backdrop -->
  <div
    class="bug-backdrop"
    role="button"
    tabindex="-1"
    aria-label="Close bug report form"
    onclick={closeForm}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') closeForm()
    }}
  ></div>

  <div class="bug-panel" role="dialog" aria-modal="true" aria-labelledby="bug-panel-title">
    <div class="bug-panel-head">
      <h2 id="bug-panel-title" class="bug-panel-title">
        <Bug size={16} />
        Report a bug
      </h2>
      <button type="button" class="bug-close" onclick={closeForm} aria-label="Close">
        <X size={16} />
      </button>
    </div>

    {#if signedIn}
      <p class="bug-panel-hint">
        Found something broken or wrong? Tell us what happened and we'll take a look. We'll record
        the page you're on automatically.
      </p>

      <textarea
        bind:this={textarea}
        bind:value={description}
        class="bug-textarea"
        rows="5"
        maxlength="2000"
        placeholder="What went wrong? What were you trying to do?"
        disabled={busy}
      ></textarea>

      <div class="bug-panel-foot">
        {#if notice}
          <span class="bug-notice" class:is-error={noticeKind === 'error'}>{notice}</span>
        {:else}
          <span class="bug-path">On: {$page.url.pathname}</span>
        {/if}
        <button type="button" class="bug-submit" disabled={busy} onclick={submit}>
          {busy ? 'Sending…' : 'Send report'}
        </button>
      </div>
    {:else}
      <p class="bug-panel-hint">Please sign in to report a bug so we can follow up with you.</p>
      <div class="bug-panel-foot">
        <span></span>
        <a href="/auth/login" class="bug-submit">Sign in</a>
      </div>
    {/if}
  </div>
{/if}

<style>
  .bug-fab {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 60;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.55rem 0.85rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text, #fff);
    background: var(--tertiary-background, rgba(30, 30, 40, 0.95));
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 999px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      transform 0.15s ease;
  }

  .bug-fab:hover {
    background: var(--hover, rgba(60, 60, 75, 0.95));
    border-color: rgba(255, 255, 255, 0.28);
    transform: translateY(-1px);
  }

  .bug-backdrop {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(1px);
    border: none;
  }

  .bug-panel {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 71;
    width: min(24rem, calc(100vw - 2rem));
    padding: 1rem;
    background: var(--secondary-background, #16161d);
    color: var(--text, #fff);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.75rem;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  }

  .bug-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .bug-panel-title {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--title, #fff);
    margin: 0;
  }

  .bug-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.4rem;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition:
      color 0.15s ease,
      background 0.15s ease;
  }

  .bug-close:hover {
    color: var(--text, #fff);
    background: rgba(255, 255, 255, 0.08);
  }

  .bug-panel-hint {
    font-size: 0.8rem;
    line-height: 1.4;
    color: rgba(255, 255, 255, 0.62);
    margin: 0 0 0.75rem;
  }

  .bug-textarea {
    width: 100%;
    padding: 0.6rem 0.7rem;
    font-size: 0.85rem;
    line-height: 1.4;
    color: var(--text, #fff);
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 0.5rem;
    resize: vertical;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .bug-textarea:focus {
    border-color: rgba(147, 197, 253, 0.5);
  }

  .bug-panel-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 0.75rem;
  }

  .bug-path {
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bug-notice {
    font-size: 0.76rem;
    color: #86efac;
  }

  .bug-notice.is-error {
    color: #fca5a5;
  }

  .bug-submit {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    padding: 0.45rem 0.85rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: #fff;
    text-decoration: none;
    background: rgba(59, 130, 246, 0.85);
    border: 1px solid rgba(147, 197, 253, 0.4);
    border-radius: 0.5rem;
    cursor: pointer;
    transition:
      background 0.15s ease,
      opacity 0.15s ease;
  }

  .bug-submit:hover:not(:disabled) {
    background: rgba(59, 130, 246, 1);
  }

  .bug-submit:disabled {
    opacity: 0.6;
    cursor: default;
  }

  /* On small screens, drop the label so the pill doesn't crowd the corner. */
  @media (max-width: 640px) {
    .bug-fab-label {
      display: none;
    }

    .bug-fab {
      padding: 0.6rem;
    }
  }
</style>
