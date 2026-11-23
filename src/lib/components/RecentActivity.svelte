<script lang="ts">
  import { resolve } from '$app/paths'
  import { MessageSquare, CalendarClock, Swords, User } from 'lucide-svelte'
  import type { RecentComment } from '$lib/server/comments/recent'

  interface Props {
    comments?: RecentComment[]
    /** Stretch to the parent's height and scroll the list inside it. */
    fill?: boolean
  }

  let { comments = [], fill = false }: Props = $props()

  const ENTITY_ICONS = { match: Swords, player: User, season: CalendarClock }

  /** Threads live on different routes, so the link is rebuilt from the entity type. */
  function threadHref(comment: RecentComment) {
    switch (comment.entityType) {
      case 'match':
        return resolve(`/matches/${comment.entityRef}`)
      case 'player':
        return resolve(`/players/${comment.entityRef}`)
      case 'season':
        return resolve(`/events/${comment.entityRef}`)
    }
  }

  /**
   * Ticks so "3m ago" ages without a refresh. The feed itself is server-cached
   * for 30s, so only the labels move between navigations.
   */
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

<section class="activity" class:activity-fill={fill}>
  <div class="activity-head">
    <MessageSquare size={16} />
    <h2 class="activity-title">Recent Discussion</h2>
  </div>

  {#if comments.length === 0}
    <p class="activity-empty">No comments yet. Start a thread on a match or player page.</p>
  {:else}
    <ul class="activity-list">
      {#each comments as comment (comment.id)}
        {@const Icon = ENTITY_ICONS[comment.entityType] ?? MessageSquare}
        <li>
          <a href={threadHref(comment)} class="activity-item">
            <div class="activity-meta">
              <Icon size={12} class="activity-icon" />
              <span class="activity-entity">{comment.entityLabel}</span>
            </div>
            <p class="activity-body">{comment.excerpt}</p>
            <div class="activity-byline">
              <span class="activity-author">{comment.authorName}</span>
              <span class="byline-dot">·</span>
              <span>{relativeTime(comment.createdAt)}</span>
            </div>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style src="./RecentActivity.css"></style>
