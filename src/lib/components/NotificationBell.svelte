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

<style src="./NotificationBell.css"></style>
