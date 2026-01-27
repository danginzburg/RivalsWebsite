<script lang="ts">
  import './layout.css'
  import favicon from '$lib/assets/favicon.svg'
  import Sidebar from '$lib/components/Sidebar.svelte'

  let { children } = $props()
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="flex min-h-screen flex-col">
  <Sidebar />
  <main class="flex-1">
    {@render children()}
  </main>
</div>
