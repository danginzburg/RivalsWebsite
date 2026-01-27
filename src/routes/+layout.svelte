<script lang="ts">
  import './layout.css'
  import favicon from '$lib/assets/favicon.svg'
  import Header from '$lib/components/Header.svelte'

  let { children } = $props()
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="flex min-h-screen flex-col">
  <Header />
  <main class="flex-1">
    {@render children()}
  </main>
</div>
