<script lang="ts">
  import './layout.css'
  import favicon from '$lib/assets/rivals_logo.webp'
  import Header from '$lib/components/Header.svelte'
  import { user, isLoading } from '$lib/stores/auth'

  let { children, data } = $props()

  // Initialize user store from server session data
  $effect(() => {
    if (data.user) {
      user.set(data.user)
    }
    isLoading.set(false)
  })
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="flex min-h-screen flex-col">
  <Header />
  <main class="flex-1">
    {@render children()}
  </main>
</div>
