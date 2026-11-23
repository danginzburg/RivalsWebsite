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

<style src="./BugReportButton.css"></style>
