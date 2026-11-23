<script lang="ts">
  import { page } from '$app/stores'
  import { resolve } from '$app/paths'
  import { Target } from 'lucide-svelte'
  import PageContainer from '$lib/components/PageContainer.svelte'
</script>

<PageContainer>
  <div class="error-wrap">
    <div class="icon-ring">
      <Target size={48} strokeWidth={1.5} />
    </div>
    <h1 class="error-code">{$page.status}</h1>
    <p class="error-message">{$page.error?.message ?? 'Page not found'}</p>
    <p class="error-detail">
      There's no active Pick'em bracket right now. Check back when the next playoff season begins!
    </p>
    <a href={resolve('/')} class="home-link">Back to Home</a>
  </div>
</PageContainer>

<style src="./error.css"></style>
