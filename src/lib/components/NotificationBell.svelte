<script lang="ts">
  import { Bell, Check, ShieldAlert, Trash2, X } from 'lucide-svelte'
  import { afterNavigate, goto } from '$app/navigation'
  import { page } from '$app/state'
  import type { NotificationRow } from '$lib/server/notifications'
  import type { AdminQueueItem } from '$lib/server/admin/pending-counts'

  interface Props {
    /** Unread count from the layout load, so the badge is right on first paint. */
    initialUnread?: number
    /** Admin review queues from the layout load; empty for everyone else. */
    initialAdminQueue?: AdminQueueItem[]
  }

  let { initialUnread = 0, initialAdminQueue = [] }: Props = $props()

  let isOpen = $state(false)
  // Once we've fetched, that value wins; until then fall back to the seed from
  // the layout load, which stays reactive to navigation.
  let fetchedUnread = $state<number | null>(null)
  const unread = $derived(fetchedUnread ?? initialUnread)
  let notifications = $state<NotificationRow[]>([])
  let fetchedAdminQueue = $state<AdminQueueItem[] | null>(null)
  // The dashboard already shows its queues, so the bell only surfaces them
  // while the admin is elsewhere on the site.
  const onAdminPage = $derived(page.url.pathname.startsWith('/admin'))
  const adminQueue = $derived(onAdminPage ? [] : (fetchedAdminQueue ?? initialAdminQueue))
  const adminPending = $derived(adminQueue.reduce((sum, item) => sum + item.count, 0))
  const badgeCount = $derived(unread + adminPending)
  let loading = $state(false)
  let hasLoaded = $state(false)

  async function refresh() {
    loading = true
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const data = await res.json()
      notifications = data.notifications ?? []
      fetchedUnread = data.unread ?? 0
      fetchedAdminQueue = data.adminQueue ?? []
      hasLoaded = true
    } catch {
      // A failed poll is non-fatal; the badge keeps its last value.
    } finally {
      loading = false
    }
  }

  function toggle() {
    isOpen = !isOpen
    if (isOpen) refresh()
  }

  function close() {
    isOpen = false
  }

  async function markAllRead() {
    const res = await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
    if (res.ok) {
      fetchedUnread = 0
      notifications = notifications.map((n) => ({ ...n, is_read: true }))
    }
  }

  async function clearAll() {
    const res = await fetch('/api/notifications', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
    if (res.ok) {
      fetchedUnread = 0
      notifications = []
    }
  }

  function dismiss(notification: NotificationRow) {
    // Drop it optimistically; a failed delete reappears on the next poll.
    notifications = notifications.filter((n) => n.id !== notification.id)
    if (!notification.is_read) fetchedUnread = Math.max(0, unread - 1)
    fetch('/api/notifications', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [notification.id] }),
    }).catch(() => {})
  }

  async function openQueue(item: AdminQueueItem) {
    close()
    // A static admin route plus a tab query; resolve() can't type the query.
    // eslint-disable-next-line svelte/no-navigation-without-resolve
    await goto(item.link)
  }

  async function open(notification: NotificationRow) {
    // Mark just this one read, optimistically, then follow its link.
    if (!notification.is_read) {
      notification.is_read = true
      fetchedUnread = Math.max(0, unread - 1)
      fetch('/api/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [notification.id] }),
      }).catch(() => {})
    }
    close()
    // The link is a server-built runtime string (with a #comment anchor), not a
    // static route, so resolve() does not apply here.
    // eslint-disable-next-line svelte/no-navigation-without-resolve
    if (notification.link) await goto(notification.link)
  }

  // Leaving the dashboard after clearing a queue should drop it from the
  // badge right away, not on the next poll.
  afterNavigate(({ from, to }) => {
    if (from?.url.pathname.startsWith('/admin') && !to?.url.pathname.startsWith('/admin')) {
      refresh()
    }
  })

  // Poll while mounted, and whenever the tab regains focus, so the badge stays
  // current without the user opening the panel. There is no realtime channel
  // for the viewer (auth is not Supabase-auth), so polling is the mechanism.
  $effect(() => {
    const id = setInterval(refresh, 45_000)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  })

  // Ticks so relative times age while the panel is open.
  let now = $state(Date.now())
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 60_000)
    return () => clearInterval(id)
  })

  function relativeTime(iso: string) {
    const then = new Date(iso).getTime()
    if (!Number.isFinite(then)) return ''
    const seconds = Math.max(0, Math.round((now - then) / 1000))
    if (seconds < 60) return 'just now'
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.round(hours / 24)
    if (days < 7) return `${days}d ago`
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
</script>

<svelte:window
  onclick={(e) => {
    // Close when clicking anywhere outside this widget.
    if (isOpen && e.target instanceof Element && !e.target.closest('.notif-root')) close()
  }}
/>

<div class="notif-root">
  <button
    type="button"
    class="icon-btn"
    class:icon-btn-active={isOpen}
    title="Notifications"
    aria-label="Notifications"
    aria-haspopup="true"
    aria-expanded={isOpen}
    onclick={toggle}
  >
    <Bell class="h-5 w-5" />
    {#if badgeCount > 0}
      <span class="badge">{badgeCount > 99 ? '99+' : badgeCount}</span>
    {/if}
  </button>

  {#if isOpen}
    <div class="panel" role="menu">
      <div class="panel-head">
        <span class="panel-title">Notifications</span>
        <div class="panel-actions">
          {#if unread > 0}
            <button type="button" class="mark-all" onclick={markAllRead}>
              <Check class="h-3.5 w-3.5" />
              Mark all read
            </button>
          {/if}
          {#if notifications.length > 0}
            <button type="button" class="mark-all" onclick={clearAll}>
              <Trash2 class="h-3.5 w-3.5" />
              Clear all
            </button>
          {/if}
        </div>
      </div>

      <div class="panel-body">
        {#if adminQueue.length > 0}
          <div class="queue">
            <span class="queue-title">Needs review</span>
            <ul class="notif-list">
              {#each adminQueue as item (item.key)}
                <li>
                  <button type="button" class="queue-item" onclick={() => openQueue(item)}>
                    <ShieldAlert class="h-4 w-4 shrink-0" />
                    <span class="queue-label">{item.label}</span>
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if !hasLoaded && loading}
          <p class="panel-empty">Loading…</p>
        {:else if notifications.length === 0}
          <p class="panel-empty">
            {adminQueue.length > 0 ? 'No new notifications.' : "You're all caught up."}
          </p>
        {:else}
          <ul class="notif-list">
            {#each notifications as n (n.id)}
              <li class="notif-row">
                <button
                  type="button"
                  class="notif-item"
                  class:unread={!n.is_read}
                  onclick={() => open(n)}
                >
                  {#if !n.is_read}<span class="dot" aria-hidden="true"></span>{/if}
                  <span class="notif-text">
                    <span class="notif-title">{n.title}</span>
                    {#if n.body}<span class="notif-body">{n.body}</span>{/if}
                    <span class="notif-time">{relativeTime(n.created_at)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="dismiss"
                  title="Clear notification"
                  aria-label="Clear notification"
                  onclick={() => dismiss(n)}
                >
                  <X class="h-3.5 w-3.5" />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .notif-root {
    position: relative;
    display: flex;
  }

  /* Mirrors the header's .icon-btn so the bell sits flush with its neighbours. */
  .icon-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.125rem;
    height: 2.125rem;
    border-radius: 0.375rem;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.72);
    cursor: pointer;
    transition:
      color 0.15s,
      background-color 0.15s;
  }

  .icon-btn:hover {
    color: var(--text);
    background-color: rgba(255, 255, 255, 0.07);
  }

  .icon-btn-active {
    color: var(--text);
    background-color: var(--active);
  }

  .badge {
    position: absolute;
    top: -0.125rem;
    right: -0.125rem;
    min-width: 1.05rem;
    height: 1.05rem;
    padding: 0 0.25rem;
    border-radius: 999px;
    background-color: var(--accent, #ef4444);
    color: #fff;
    font-size: 0.625rem;
    font-weight: 700;
    line-height: 1.05rem;
    text-align: center;
  }

  .panel {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    width: 22rem;
    max-width: calc(100vw - 1.5rem);
    max-height: 26rem;
    display: flex;
    flex-direction: column;
    background-color: var(--secondary-background, #1a1a1a);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.625rem;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    overflow: hidden;
    z-index: 60;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 0.75rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .panel-title {
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--title, #fff);
  }

  .panel-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .mark-all {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
  }

  .mark-all:hover {
    color: var(--text, #fff);
    background-color: rgba(255, 255, 255, 0.07);
  }

  .panel-body {
    overflow-y: auto;
  }

  .panel-empty {
    margin: 0;
    padding: 1.5rem 0.75rem;
    text-align: center;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .notif-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .queue {
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 0.25rem;
  }

  .queue-title {
    display: block;
    padding: 0.5rem 0.75rem 0.25rem;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
  }

  .queue-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    padding: 0.4375rem 0.75rem;
    border: none;
    background: transparent;
    color: var(--accent, #ef4444);
    cursor: pointer;
    transition: background-color 0.12s;
  }

  .queue-item:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }

  .queue-label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text, #fff);
  }

  .notif-row {
    position: relative;
  }

  /* Sits over the row's top-right corner; the row's right padding keeps text
     clear of it. Hidden until hover on pointer devices, always shown on touch. */
  .dismiss {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border: none;
    border-radius: 0.25rem;
    background: transparent;
    color: rgba(255, 255, 255, 0.45);
    cursor: pointer;
  }

  .dismiss:hover,
  .dismiss:focus-visible {
    color: var(--text, #fff);
    background-color: rgba(255, 255, 255, 0.1);
  }

  @media (hover: hover) {
    .dismiss {
      opacity: 0;
    }

    .notif-row:hover .dismiss,
    .dismiss:focus-visible {
      opacity: 1;
    }
  }

  .notif-item {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    padding: 0.625rem 2.25rem 0.625rem 0.75rem;
    border: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: transparent;
    cursor: pointer;
    transition: background-color 0.12s;
  }

  .notif-item:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }

  .notif-item.unread {
    background-color: rgba(255, 255, 255, 0.03);
  }

  .dot {
    flex-shrink: 0;
    width: 0.5rem;
    height: 0.5rem;
    margin-top: 0.3125rem;
    border-radius: 999px;
    background-color: var(--accent, #ef4444);
  }

  .notif-text {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .notif-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text, #fff);
  }

  .notif-body {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.65);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .notif-time {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.4);
  }

  /* Unread rows that have no leading dot (already-read after mark-all) keep the
     title indented in line with dotted rows. */
  .notif-item:not(.unread) .notif-text {
    margin-left: calc(0.5rem + 0.5rem);
  }

  /* On narrow screens the bell isn't flush with the viewport edge (the menu
     toggle sits to its right), so anchoring the panel to the bell with a
     near-full width pushes its left edge off-screen. Pin it to the viewport
     instead so it always stays inside the window. */
  @media (max-width: 480px) {
    .panel {
      position: fixed;
      top: 3.75rem;
      right: 0.75rem;
      left: 0.75rem;
      width: auto;
      max-width: none;
      max-height: calc(100vh - 4.5rem);
    }
  }
</style>
