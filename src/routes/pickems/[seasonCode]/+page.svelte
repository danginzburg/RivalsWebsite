<script lang="ts">
  import { untrack } from 'svelte'

  import { page } from '$app/state'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import type { PickemFormat } from '$lib/pickems'
  import PickemDisplay from './PickemDisplay.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  const hasBoth = $derived(Boolean(data.playoffs && data.weekly))

  // `?view=playoffs|weekly` picks the display; otherwise the one taking picks.
  function viewFromUrl(): PickemFormat | null {
    const view = page.url.searchParams.get('view')
    if (view === 'weekly') return 'matchups'
    if (view === 'playoffs') return 'bracket'
    return null
  }
  let view = $state<PickemFormat>(untrack(() => viewFromUrl() ?? data.defaultView))
  const activeView = $derived<PickemFormat>(
    view === 'matchups'
      ? data.weekly
        ? 'matchups'
        : 'bracket'
      : data.playoffs
        ? 'bracket'
        : 'matchups'
  )

  function show(next: PickemFormat) {
    view = next
    // Keep the choice in the URL (shareable, survives reload) without a navigation.
    const url = new URL(window.location.href)
    url.searchParams.set('view', next === 'matchups' ? 'weekly' : 'playoffs')
    window.history.replaceState(window.history.state, '', url)
  }

  function headingFor(title: string | undefined) {
    return hasBoth ? "Pick'em" : title || "Pick'em"
  }
</script>

<PageContainer class="pickem-page">
  <!-- Both stay mounted so unsaved picks survive switching displays. -->
  {#if data.playoffs}
    <div hidden={activeView !== 'bracket'}>
      <PickemDisplay
        display={data.playoffs}
        season={data.season}
        heading={headingFor(data.playoffs.event.title)}
        seasonBoard={data.seasonBoard}
        seasonChampionId={data.seasonChampionId}
        me={data.me}
        tabs={hasBoth ? displayTabs : undefined}
      />
    </div>
  {/if}
  {#if data.weekly}
    <div hidden={activeView !== 'matchups'}>
      <PickemDisplay
        display={data.weekly}
        season={data.season}
        heading={headingFor(data.weekly.event.title)}
        seasonBoard={data.seasonBoard}
        seasonChampionId={data.seasonChampionId}
        me={data.me}
        tabs={hasBoth ? displayTabs : undefined}
      />
    </div>
  {/if}
</PageContainer>

{#snippet displayTabs()}
  <div class="pk-tabs" role="tablist" aria-label="Pick'em displays">
    <button
      type="button"
      role="tab"
      class="pk-tab"
      class:pk-tab-on={activeView === 'bracket'}
      aria-selected={activeView === 'bracket'}
      onclick={() => show('bracket')}
    >
      Playoffs
    </button>
    <button
      type="button"
      role="tab"
      class="pk-tab"
      class:pk-tab-on={activeView === 'matchups'}
      aria-selected={activeView === 'matchups'}
      onclick={() => show('matchups')}
    >
      Weekly
    </button>
  </div>
{/snippet}

<style src="./page.css"></style>
