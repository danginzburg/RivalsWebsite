<script lang="ts">
  import { resolve } from '$app/paths'
  import { MessageSquare, CalendarClock, Swords, User } from 'lucide-svelte'
  import type { RecentComment } from '$lib/server/comments/recent'

  interface Props {
    comments?: RecentComment[]
  }

  let { comments = [] }: Props = $props()

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

<section class="activity">
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

<style>
  .activity {
    border-radius: 0.625rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.2);
    overflow: hidden;
  }

  .activity-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    color: var(--accent-text);
  }

  .activity-title {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--title);
  }

  .activity-empty {
    padding: 1.5rem 1rem;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.55);
  }

  .activity-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .activity-list li + li {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .activity-item {
    display: block;
    padding: 0.75rem 1rem;
    text-decoration: none;
    color: var(--text);
    transition: background 0.15s;
  }

  .activity-item:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .activity-meta {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--accent-text);
    margin-bottom: 0.25rem;
  }

  .activity-entity {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-body {
    font-size: 0.8125rem;
    line-height: 1.45;
    color: rgba(255, 255, 255, 0.78);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .activity-byline {
    display: flex;
    align-items: center;
    gap: 0.3125rem;
    margin-top: 0.375rem;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .activity-author {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.68);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 10rem;
  }

  .byline-dot {
    opacity: 0.5;
  }
</style>
