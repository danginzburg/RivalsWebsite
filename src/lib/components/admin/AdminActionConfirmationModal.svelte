<script lang="ts">
  interface Props {
    open: boolean
    title: string
    message: string
    confirmLabel: string
    onCancel: () => void
    onConfirm: () => void
  }

  let { open, title, message, confirmLabel, onCancel, onConfirm }: Props = $props()
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
    <div
      class="w-full max-w-md rounded-lg border p-6 text-center"
      style="border-color: rgba(255, 255, 255, 0.2); background: var(--secondary-background);"
    >
      <h3 class="mb-3 text-xl font-bold" style="color: var(--title);">
        {title}
      </h3>
      <p class="mb-5 text-sm" style="color: var(--text);">
        {message}
      </p>
      <div class="flex justify-center gap-3">
        <button
          type="button"
          class="rounded-md border px-4 py-2"
          style="border-color: rgba(255,255,255,0.2); color: var(--text);"
          onclick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded-md px-4 py-2 font-semibold"
          style="background: var(--accent); color: var(--text);"
          onclick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}
