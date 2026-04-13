<script lang="ts">
  import type { PickemTeamRow } from '$lib/server/pickems'
  import type { PickemBucket } from '$lib/pickemBuckets'

  type Props = {
    row: PickemTeamRow
    isLocked: boolean
    selected: PickemBucket
    allowed: PickemBucket[]
    bucketLabels: Record<PickemBucket, string>
    shortLabel: string
    fullLabel: string
    onPick: (bucket: PickemBucket) => void
    /** Wider tap targets when embedded in a matchup pair */
    dense?: boolean
  }

  let {
    row,
    isLocked,
    selected,
    allowed,
    bucketLabels,
    shortLabel,
    fullLabel,
    onPick,
    dense = false,
  }: Props = $props()
</script>

<div
  class="pickem-team flex min-w-0 flex-col gap-1.5 rounded-md border px-2 py-1.5 sm:flex-row sm:items-center sm:gap-2"
  class:pickem-team--dense={dense}
  style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.22);"
>
  <div class="flex min-w-0 flex-1 items-center gap-1.5">
    {#if row.team?.logo_url}
      <img src={row.team.logo_url} alt="" class="h-5 w-5 shrink-0 rounded-sm object-contain" />
    {/if}
    <div class="min-w-0 leading-tight" title={fullLabel}>
      <div class="truncate text-sm font-semibold" style="color: var(--text);">
        {shortLabel}
      </div>
      <div class="truncate text-[11px]" style="color: rgba(255,255,255,0.55);">
        Seed #{row.rank} · RD {row.round_diff}
      </div>
    </div>
  </div>
  <div
    class="flex shrink-0 flex-wrap gap-0.5 sm:justify-end"
    role="group"
    aria-label="Final bucket for {fullLabel}"
  >
    {#each allowed as bucket (bucket)}
      <button
        type="button"
        class="min-h-8 min-w-9 rounded px-1.5 py-1 text-[11px] leading-none font-semibold transition-colors disabled:opacity-50"
        style={selected === bucket
          ? 'background: rgba(59,130,246,0.35); color: #bfdbfe; box-shadow: inset 0 0 0 1px rgba(147,197,253,0.45);'
          : 'background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.72);'}
        disabled={isLocked}
        aria-pressed={selected === bucket}
        onclick={() => onPick(bucket)}
      >
        {bucketLabels[bucket]}
      </button>
    {/each}
  </div>
</div>

<style>
  .pickem-team--dense :global(button) {
    min-height: 2.25rem;
    min-width: 2.5rem;
    font-size: 0.7rem;
  }
</style>
