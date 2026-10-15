<script lang="ts">
  interface Props {
    open: boolean
    title: string
    message: string
    confirmLabel: string
    /** Optional caution shown in a highlighted box under the message. */
    warning?: string | null
    /** 'danger' paints the confirm button red, for destructive actions. */
    tone?: 'default' | 'danger'
    onCancel: () => void
    onConfirm: () => void
  }

  let {
    open,
    title,
    message,
    confirmLabel,
    warning = null,
    tone = 'default',
    onCancel,
    onConfirm,
  }: Props = $props()

  function onKeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') onCancel()
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <div
      class="w-full max-w-md rounded-lg border p-6 text-center"
      style="border-color: rgba(255, 255, 255, 0.45); background: var(--secondary-background);"
    >
      <h3 class="mb-3 text-xl font-bold" style="color: var(--title);">
        {title}
      </h3>
      <p class="mb-5 text-sm whitespace-pre-line" style="color: var(--text);">
        {message}
      </p>
      {#if warning}
        <p
          class="mb-5 rounded-md border px-3 py-2 text-left text-xs leading-relaxed"
          style="border-color: rgba(251, 191, 36, 0.45); background: rgba(251, 191, 36, 0.08); color: #fcd34d;"
        >
          {warning}
        </p>
      {/if}
      <div class="flex justify-center gap-3">
        <button
          type="button"
          class="rounded-md border px-4 py-2"
          style="border-color: rgba(255,255,255,0.45); color: var(--text);"
          onclick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded-md px-4 py-2 font-semibold"
          style={tone === 'danger'
            ? 'background: #dc2626; color: #fff;'
            : 'background: var(--accent); color: var(--text);'}
          onclick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}
