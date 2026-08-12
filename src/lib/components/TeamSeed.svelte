<script lang="ts">
  /**
   * A team's seed, rendered consistently wherever a team appears.
   * Renders nothing when the team has no seed, so callers can drop it in
   * without guarding.
   */
  interface Props {
    seed?: number | null
    /** `chip` reads better beside a logo; `bare` suits dense table cells. */
    variant?: 'chip' | 'bare'
    /**
     * Seeds come from the playoff bracket, but only the leaderboard is about
     * playoff qualification — everywhere else the number is just the seed, so
     * naming it "playoff" there reads as if it meant something extra.
     */
    label?: string
  }

  let { seed = null, variant = 'chip', label = 'Seed' }: Props = $props()
</script>

{#if seed != null}
  <span
    class="team-seed"
    class:seed-chip={variant === 'chip'}
    class:seed-bare={variant === 'bare'}
    title="{label} {seed}"
  >
    {seed}
  </span>
{/if}

<style>
  .team-seed {
    flex-shrink: 0;
    font-size: 0.5625rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    text-align: center;
  }

  .seed-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.0625rem;
    padding: 0.1875rem 0.25rem;
    border-radius: 0.25rem;
    background: rgba(255, 255, 255, 0.09);
    color: rgba(255, 255, 255, 0.62);
  }

  .seed-bare {
    display: inline-block;
    min-width: 0.875rem;
    color: rgba(255, 255, 255, 0.64);
  }
</style>
