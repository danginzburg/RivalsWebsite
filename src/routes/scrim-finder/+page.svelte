<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import { Swords } from 'lucide-svelte'
</script>

<svelte:head><title>Scrim Finder</title></svelte:head>

<PageContainer>
  <div class="page-content-narrow py-6">
    <PageHeading
      title="Scrim Finder"
      subtitle="Find practice matches against other teams."
      icon={Swords}
    />

    <div class="placeholder">
      <Swords size={36} style="color: rgba(255,255,255,0.45);" />
      <p class="placeholder-title">Coming soon</p>
      <p class="placeholder-text">
        Scrim scheduling isn't available yet. Use the Discord in the meantime.
      </p>
    </div>
  </div>
</PageContainer>

<style>
  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    text-align: center;
    padding: 4rem 1.5rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.18);
  }

  .placeholder-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
  }

  .placeholder-text {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.6);
    max-width: 28rem;
    line-height: 1.55;
  }
</style>
