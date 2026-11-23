<script lang="ts">
  import './layout.css'
  import favicon from '$lib/assets/rivals_logo.webp'
  import Header from '$lib/components/Header.svelte'
  import BugReportButton from '$lib/components/BugReportButton.svelte'
  import SocialMeta from '$lib/components/SocialMeta.svelte'
  import { user, isLoading } from '$lib/stores/auth'
  import { externalEvents } from '$lib/stores/external-events.svelte'
  import { compareTray } from '$lib/stores/search.svelte'
  import { onMount } from 'svelte'

  let { children, data } = $props()

  // After hydration, so the first client render matches the server's (hidden).
  onMount(() => {
    externalEvents.load()
    compareTray.load()
  })

  // Initialize user store from server session data
  $effect(() => {
    if (data.user) {
      user.set(data.user)
    }
    isLoading.set(false)
  })
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<SocialMeta />

<div class="flex min-h-screen flex-col">
  <Header />
  <main class="flex-1">
    {@render children()}
  </main>
</div>

<BugReportButton signedIn={Boolean(data.user)} />
