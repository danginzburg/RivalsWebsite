<script lang="ts">
  import {
    MessageSquare,
    Reply,
    Flag,
    Trash2,
    Pencil,
    X,
    Check,
    ChevronUp,
    ChevronDown,
  } from 'lucide-svelte'
  import { resolve } from '$app/paths'
  import type { Snippet } from 'svelte'
  import type { CommentNode, CommentEntityType } from '$lib/server/comments'

  interface Props {
    entityType: CommentEntityType
    entityId: string
    comments: CommentNode[]
    /** Null when signed out — the composer is replaced by a sign-in prompt. */
    viewerId: string | null
    isAdmin?: boolean
    /** Optional control rendered at the right edge of the header row (e.g. a flag button). */
    headerAction?: Snippet
    /** 'flush' sits as a section of a page sheet instead of a separate card. */
    variant?: 'card' | 'flush'
  }

  let {
    entityType,
    entityId,
    comments,
    viewerId,
    isAdmin = false,
    headerAction,
    variant = 'card',
  }: Props = $props()

  const MAX_LENGTH = 2000

  /**
   * Server-rendered `comments` is the source of truth until the viewer acts;
   * every mutation returns the rebuilt thread, which we hold here so the list
   * updates without a round trip through the page load.
   */
  let localThread = $state<CommentNode[] | null>(null)
  const thread = $derived(localThread ?? comments)

  let draft = $state('')
  let replyingTo = $state<string | null>(null)
  let replyDraft = $state('')
  let editingId = $state<string | null>(null)
  let editDraft = $state('')
  let busy = $state(false)
  let errorMessage = $state<string | null>(null)
  let noticeMessage = $state<string | null>(null)

  // Navigating to a different entity drops any locally-held thread.
  $effect(() => {
    entityId
    localThread = null
  })

  const totalCount = $derived(
    thread.reduce(
      (sum, node) =>
        sum + (node.is_deleted ? 0 : 1) + node.replies.filter((r) => !r.is_deleted).length,
      0
    )
  )

  async function send(url: string, init: RequestInit) {
    busy = true
    errorMessage = null
    noticeMessage = null
    try {
      const response = await fetch(url, init)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.message ?? 'Something went wrong')
      }
      if (Array.isArray(payload.comments)) localThread = payload.comments
      return payload
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Something went wrong'
      return null
    } finally {
      busy = false
    }
  }

  async function postComment(parentId: string | null) {
    const body = (parentId ? replyDraft : draft).trim()
    if (!body) return

    const result = await send('/api/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityType, entityId, body, parentId }),
    })

    if (result) {
      if (parentId) {
        replyDraft = ''
        replyingTo = null
      } else {
        draft = ''
      }
    }
  }

  async function saveEdit(id: string) {
    const body = editDraft.trim()
    if (!body) return

    const result = await send('/api/comments', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, body }),
    })

    if (result) {
      editingId = null
      editDraft = ''
    }
  }

  async function deleteComment(id: string) {
    if (!window.confirm('Delete this comment?')) return
    await send(`/api/comments?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async function reportComment(id: string) {
    const reason = window.prompt('Why are you reporting this comment? (optional)')
    // A null return means the user cancelled the prompt.
    if (reason === null) return

    const result = await send('/api/comments/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commentId: id, reason }),
    })

    if (result) {
      noticeMessage = result.alreadyReported
        ? 'You already reported this comment.'
        : 'Report submitted. Thanks for flagging it.'
    }
  }

  /**
   * Clicking the arrow you already picked clears the vote, which is what the
   * server reads a 0 as.
   */
  async function vote(node: CommentNode, direction: 1 | -1) {
    const next = node.viewer_vote === direction ? 0 : direction

    await send('/api/comments/vote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commentId: node.id, value: next }),
    })
  }

  function startEdit(node: CommentNode) {
    editingId = node.id
    editDraft = node.body ?? ''
    replyingTo = null
  }

  function startReply(id: string) {
    replyingTo = replyingTo === id ? null : id
    replyDraft = ''
    editingId = null
  }

  function canModify(node: CommentNode) {
    return Boolean(viewerId && node.author?.id === viewerId)
  }

  /** Signed in, and not the author — the server enforces both as well. */
  function canVote(node: CommentNode) {
    return Boolean(viewerId) && !canModify(node)
  }

  function formatTime(value: string) {
    const date = new Date(value)
    const diffMs = Date.now() - date.getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }
</script>

<section class="comments" class:comments-flush={variant === 'flush'}>
  <header class="comments-header">
    <h2 class="comments-title">
      <MessageSquare size={16} />
      Discussion
      {#if totalCount > 0}
        <span class="comment-count">{totalCount}</span>
      {/if}
    </h2>
    {#if headerAction}
      <div class="comments-header-action">{@render headerAction()}</div>
    {/if}
  </header>

  {#if errorMessage}
    <div class="alert alert-error">{errorMessage}</div>
  {/if}
  {#if noticeMessage}
    <div class="alert alert-notice">{noticeMessage}</div>
  {/if}

  <!-- Composer -->
  {#if viewerId}
    <div class="composer">
      <textarea
        bind:value={draft}
        rows="3"
        maxlength={MAX_LENGTH}
        class="composer-input"
        placeholder="Add a comment..."
        disabled={busy}
      ></textarea>
      <div class="composer-footer">
        <span class="char-count" class:char-count-warn={draft.length > MAX_LENGTH * 0.9}>
          {draft.length}/{MAX_LENGTH}
        </span>
        <button
          type="button"
          class="btn btn-primary"
          disabled={busy || draft.trim().length === 0}
          onclick={() => postComment(null)}
        >
          {busy ? 'Posting...' : 'Post'}
        </button>
      </div>
    </div>
  {:else}
    <div class="signin-prompt">
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a href="/auth/login">Sign in</a> to join the discussion.
    </div>
  {/if}

  <!-- Thread -->
  {#if thread.length === 0}
    <p class="empty">No comments yet. Be the first to say something.</p>
  {:else}
    <div class="thread">
      {#each thread as node (node.id)}
        <div class="comment-block">
          {@render comment(node, false)}
          {#if node.replies.length > 0}
            <div class="replies">
              {#each node.replies as reply (reply.id)}
                {@render comment(reply, true)}
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

{#snippet comment(node: CommentNode, isReply: boolean)}
  <!-- Anchor target so notification links (#comment-{id}) land on the right comment. -->
  <article id="comment-{node.id}" class="comment" class:comment-reply={isReply}>
    {#if node.is_deleted}
      <p class="deleted">This comment was removed.</p>
    {:else}
      <div class="comment-head">
        {#if node.author}
          <a href={resolve(`/players/${node.author.id}`)} class="comment-author">
            {node.author.name}
          </a>
          {#if node.author.role === 'admin'}
            <span class="role-badge">Admin</span>
          {/if}
        {:else}
          <span class="comment-author">Unknown</span>
        {/if}
        <span class="comment-time">{formatTime(node.created_at)}</span>
        {#if node.edited_at}
          <span class="edited">edited</span>
        {/if}
        {#if isAdmin && node.report_count > 0}
          <span class="report-badge"
            >{node.report_count} report{node.report_count === 1 ? '' : 's'}</span
          >
        {/if}
      </div>

      {#if editingId === node.id}
        <textarea
          bind:value={editDraft}
          rows="3"
          maxlength={MAX_LENGTH}
          class="composer-input"
          disabled={busy}
        ></textarea>
        <div class="comment-actions">
          <button
            type="button"
            class="action action-confirm"
            disabled={busy}
            onclick={() => saveEdit(node.id)}
          >
            <Check size={13} /> Save
          </button>
          <button type="button" class="action" onclick={() => (editingId = null)}>
            <X size={13} /> Cancel
          </button>
        </div>
      {:else}
        <p class="comment-body">{node.body}</p>
        <div class="comment-actions">
          <!-- Score is shown to everyone; only a signed-in non-author can move it. -->
          <div class="votes" class:votes-readonly={!canVote(node)}>
            <button
              type="button"
              class="vote-btn"
              class:vote-on={node.viewer_vote === 1}
              disabled={busy || !canVote(node)}
              aria-pressed={node.viewer_vote === 1}
              aria-label="Upvote"
              title={canVote(node) ? 'Upvote' : 'Sign in to vote'}
              onclick={() => vote(node, 1)}
            >
              <ChevronUp size={14} />
            </button>
            <span
              class="vote-score"
              class:vote-score-up={node.score > 0}
              class:vote-score-down={node.score < 0}
            >
              {node.score}
            </span>
            <button
              type="button"
              class="vote-btn"
              class:vote-on-down={node.viewer_vote === -1}
              disabled={busy || !canVote(node)}
              aria-pressed={node.viewer_vote === -1}
              aria-label="Downvote"
              title={canVote(node) ? 'Downvote' : 'Sign in to vote'}
              onclick={() => vote(node, -1)}
            >
              <ChevronDown size={14} />
            </button>
          </div>

          {#if viewerId && !isReply}
            <button type="button" class="action" onclick={() => startReply(node.id)}>
              <Reply size={13} /> Reply
            </button>
          {/if}
          {#if viewerId && isReply}
            <button type="button" class="action" onclick={() => startReply(node.id)}>
              <Reply size={13} /> Reply
            </button>
          {/if}
          {#if canModify(node)}
            <button type="button" class="action" onclick={() => startEdit(node)}>
              <Pencil size={13} /> Edit
            </button>
          {/if}
          {#if canModify(node) || isAdmin}
            <button
              type="button"
              class="action action-danger"
              disabled={busy}
              onclick={() => deleteComment(node.id)}
            >
              <Trash2 size={13} /> Delete
            </button>
          {/if}
          {#if viewerId && !canModify(node)}
            <button
              type="button"
              class="action"
              disabled={busy}
              onclick={() => reportComment(node.id)}
            >
              <Flag size={13} /> Report
            </button>
          {/if}
        </div>
      {/if}

      {#if replyingTo === node.id}
        <div class="reply-composer">
          <textarea
            bind:value={replyDraft}
            rows="2"
            maxlength={MAX_LENGTH}
            class="composer-input"
            placeholder="Write a reply..."
            disabled={busy}
          ></textarea>
          <div class="composer-footer">
            <button type="button" class="action" onclick={() => (replyingTo = null)}>Cancel</button>
            <button
              type="button"
              class="btn btn-primary"
              disabled={busy || replyDraft.trim().length === 0}
              onclick={() => postComment(node.id)}
            >
              {busy ? 'Posting...' : 'Reply'}
            </button>
          </div>
        </div>
      {/if}
    {/if}
  </article>
{/snippet}

<style src="./CommentThread.css"></style>
