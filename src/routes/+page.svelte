<script lang="ts">
  import herobackground from '$lib/assets/img/mvp.webp'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import HeroSection from '$lib/components/HeroSection.svelte'
</script>

<PageContainer>
  <HeroSection
    image={herobackground}
    title="Welcome to Throw City Rivals!"
    subtitle="Throw City Rivals finally got a home."
    description="One spot to see the brackets, the stats, and who's actually throwing."
  />
</PageContainer>
