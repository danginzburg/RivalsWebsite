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

<style src="./TeamSeed.css"></style>
