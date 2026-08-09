<script lang="ts">
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { resolve } from '$app/paths'
  import type { CommentReport } from '$lib/admin/types'

  interface Props {
    reports: CommentReport[]
    reportsLoaded: boolean
    statusFilter: string
    processingReportId: string | null
    onStatusFilterChange: (value: string) => void
    onResolve: (reportId: string) => void
    onDismiss: (reportId: string) => void
    onDeleteComment: (commentId: string, reportId: string) => void
    onBanUser: (profileId: string, name: string) => void
    onUnbanUser: (profileId: string, name: string) => void
  }

  let {
    reports,
    reportsLoaded,
    statusFilter,
    processingReportId,
    onStatusFilterChange,
    onResolve,
    onDismiss,
    onDeleteComment,
    onBanUser,
    onUnbanUser,
  }: Props = $props()

  const statusOptions = [
    { value: 'pending', label: 'Pending' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'dismissed', label: 'Dismissed' },
    { value: 'all', label: 'All' },
  ]

  function entityHref(report: CommentReport) {
    const comment = report.comment
    if (!comment) return null
    return comment.entity_type === 'match'
      ? resolve(`/matches/${comment.entity_id}`)
      : resolve(`/players/${comment.entity_id}`)
  }

  function isBanned(until: string | null | undefined) {
    if (!until) return false
    const date = new Date(until)
    return Number.isFinite(date.getTime()) && date.getTime() > Date.now()
  }

  function formatDate(value: string) {
    return new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  function statusStyle(status: string) {
    if (status === 'pending') return 'background: rgba(251,191,36,0.16); color: #fcd34d;'
    if (status === 'resolved') return 'background: rgba(74,222,128,0.16); color: #86efac;'
    return 'background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6);'
  }
</script>

<section class="rounded-md border p-3" style="border-color: rgba(255,255,255,0.12);">
  <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
    <div
      class="text-sm font-semibold tracking-wide uppercase"
      style="color: rgba(255,255,255,0.8);"
    >
      Reported Comments ({reports.length})
    </div>
    <div class="w-full md:w-48">
      <CustomSelect
        options={statusOptions}
        value={statusFilter}
        compact={true}
        placeholder="Filter by status"
        onSelect={onStatusFilterChange}
      />
    </div>
  </div>

  {#if !reportsLoaded}
    <div class="py-10 text-center text-sm" style="color: rgba(255,255,255,0.72);">
      Loading reports...
    </div>
  {:else if reports.length === 0}
    <div class="py-10 text-center text-sm" style="color: rgba(255,255,255,0.72);">
      {statusFilter === 'pending'
        ? 'No pending reports. Nothing to review.'
        : 'No reports match this filter.'}
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-2">
      {#each reports as report (report.id)}
        {@const href = entityHref(report)}
        {@const banned = isBanned(report.comment?.author?.banned_until)}
        <article
          class="rounded-md border p-3"
          style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.2);"
        >
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <span
              class="rounded px-2 py-0.5 text-[10px] font-bold uppercase"
              style={statusStyle(report.status)}
            >
              {report.status}
            </span>
            <span class="text-xs" style="color: rgba(255,255,255,0.5);">
              Reported by <strong style="color: rgba(255,255,255,0.75);"
                >{report.reporter.name}</strong
              >
              · {formatDate(report.created_at)}
            </span>
            {#if href}
              <a
                {href}
                class="ml-auto text-xs font-semibold"
                style="color: #93c5fd;"
                target="_blank"
                rel="noopener noreferrer"
              >
                View in context →
              </a>
            {/if}
          </div>

          {#if report.reason}
            <div
              class="mb-2 rounded p-2 text-xs"
              style="background: rgba(251,191,36,0.07); color: #fde68a;"
            >
              <strong>Reason:</strong>
              {report.reason}
            </div>
          {/if}

          {#if report.comment}
            <div
              class="rounded p-2"
              style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);"
            >
              <div class="mb-1 flex flex-wrap items-center gap-2 text-xs">
                <span class="font-semibold" style="color: var(--text);">
                  {report.comment.author.name}
                </span>
                {#if banned}
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                    style="background: rgba(248,113,113,0.18); color: #fca5a5;"
                  >
                    Banned
                  </span>
                {/if}
                <span style="color: rgba(255,255,255,0.4);">
                  {formatDate(report.comment.created_at)}
                </span>
                {#if report.comment.is_deleted}
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                    style="background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.55);"
                  >
                    Deleted
                  </span>
                {/if}
              </div>
              <p
                class="text-sm whitespace-pre-wrap"
                style="color: rgba(255,255,255,0.78); word-break: break-word;"
              >
                {report.comment.body}
              </p>
            </div>
          {:else}
            <div class="text-xs italic" style="color: rgba(255,255,255,0.4);">
              The reported comment no longer exists.
            </div>
          {/if}

          <div class="mt-3 flex flex-wrap justify-end gap-2">
            {#if report.status === 'pending'}
              <button
                type="button"
                class="rounded px-3 py-1.5 text-xs font-semibold"
                style="background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7);"
                disabled={processingReportId === report.id}
                onclick={() => onDismiss(report.id)}
              >
                Dismiss
              </button>
            {/if}
            {#if report.comment && !report.comment.is_deleted}
              <button
                type="button"
                class="rounded px-3 py-1.5 text-xs font-semibold"
                style="background: rgba(248,113,113,0.2); color: #f87171;"
                disabled={processingReportId === report.id}
                onclick={() => onDeleteComment(report.comment!.id, report.id)}
              >
                Delete Comment
              </button>
            {/if}
            {#if report.comment}
              {#if banned}
                <button
                  type="button"
                  class="rounded px-3 py-1.5 text-xs font-semibold"
                  style="background: rgba(74,222,128,0.18); color: #86efac;"
                  disabled={processingReportId === report.id}
                  onclick={() =>
                    onUnbanUser(report.comment!.author.id, report.comment!.author.name)}
                >
                  Lift Ban
                </button>
              {:else}
                <button
                  type="button"
                  class="rounded px-3 py-1.5 text-xs font-semibold"
                  style="background: rgba(245,158,11,0.18); color: #fcd34d;"
                  disabled={processingReportId === report.id}
                  onclick={() => onBanUser(report.comment!.author.id, report.comment!.author.name)}
                >
                  Ban from Commenting
                </button>
              {/if}
            {/if}
            {#if report.status === 'pending'}
              <button
                type="button"
                class="rounded px-3 py-1.5 text-xs font-semibold"
                style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                disabled={processingReportId === report.id}
                onclick={() => onResolve(report.id)}
              >
                {processingReportId === report.id ? 'Working...' : 'Mark Resolved'}
              </button>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>
