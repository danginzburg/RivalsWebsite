<script lang="ts" module>
  import type { SearchIndex } from '$lib/search'

  // One fetch per page load, shared by every open of the palette.
  let indexPromise: Promise<SearchIndex> | null = null

  /** Start loading the index (on hover or focus of the trigger, say) so the first open is instant. */
  export function prefetchSearchIndex(): Promise<SearchIndex> {
    indexPromise ??= fetch('/api/search')
      .then((res) => {
        if (!res.ok) throw new Error(`Search index failed: ${res.status}`)
        return res.json() as Promise<SearchIndex>
      })
      .catch((err) => {
        // Let the next open retry instead of caching the failure.
        indexPromise = null
        throw err
      })
    return indexPromise
  }
</script>

<script lang="ts">
  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { tick } from 'svelte'
  import { Search, Users, User } from 'lucide-svelte'
  import { searchIndex, type SearchPlayer, type SearchTeam } from '$lib/search'
  import { externalEvents } from '$lib/stores/external-events.svelte'

  let { open = $bindable(false) }: { open?: boolean } = $props()

  let query = $state('')
  let index = $state<SearchIndex | null>(null)
  let loadError = $state(false)
  let activeIndex = $state(0)
  let inputEl = $state<HTMLInputElement | null>(null)
  // Image URLs that failed to load (a stale Discord avatar, say); they fall back to initials.
  let brokenImages = $state<Record<string, true>>({})

  type Item =
    | { kind: 'player'; key: string; href: string; player: SearchPlayer }
    | { kind: 'team'; key: string; href: string; team: SearchTeam }

  const results = $derived(
    index
      ? searchIndex(index, query, { includeExternal: externalEvents.show })
      : { players: [], teams: [] }
  )

  /** Players then teams, flattened so the arrow keys walk both lists. */
  const items = $derived<Item[]>([
    ...results.players.map((player) => ({
      kind: 'player' as const,
      key: `p:${player.id}`,
      href: resolve('/players/[id]', { id: player.id }),
      player,
    })),
    ...results.teams.map((team) => ({
      kind: 'team' as const,
      key: `t:${team.id}`,
      href: resolve('/teams/[id]', { id: team.id }),
      team,
    })),
  ])

  // A new query starts back at the top result.
  $effect(() => {
    void query
    activeIndex = 0
  })

  $effect(() => {
    if (!open) return
    loadError = false
    prefetchSearchIndex()
      .then((loaded) => (index = loaded))
      .catch(() => (loadError = true))
    tick().then(() => inputEl?.focus())
  })

  function close() {
    open = false
    query = ''
  }

  function choose(item: Item | undefined) {
    if (!item) return
    close()
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- href comes from resolve() above
    goto(item.href)
  }

  function onInputKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (items.length) activeIndex = (activeIndex + 1) % items.length
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (items.length) activeIndex = (activeIndex - 1 + items.length) % items.length
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(items[activeIndex])
    }
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (open) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
      return
    }
    const isShortcut =
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') ||
      (event.key === '/' && !isTypingTarget(event.target))
    if (isShortcut) {
      event.preventDefault()
      open = true
    }
  }

  function initials(name: string): string {
    return name.trim().slice(0, 2).toUpperCase()
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="search-backdrop" onclick={close}>
    <div
      class="search-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Search players and teams"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
    >
      <div class="search-input-row">
        <span class="search-input-icon"><Search class="h-4 w-4" /></span>
        <input
          bind:this={inputEl}
          bind:value={query}
          onkeydown={onInputKeydown}
          class="search-input"
          type="search"
          placeholder="Search players, Riot IDs and teams"
          autocomplete="off"
          spellcheck="false"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="search-results"
          aria-activedescendant={items[activeIndex]
            ? `search-${items[activeIndex].key}`
            : undefined}
        />
        <kbd class="search-kbd">Esc</kbd>
      </div>

      <div class="search-body" id="search-results" role="listbox">
        {#if loadError}
          <p class="search-message">Search is unavailable right now. Try again in a moment.</p>
        {:else if !index}
          <p class="search-message">Loading…</p>
        {:else if !query.trim()}
          <p class="search-message">
            Type a player name, Riot ID or team. Press <kbd class="search-kbd">/</kbd> or
            <kbd class="search-kbd">Ctrl K</kbd> anywhere to open search.
          </p>
        {:else if items.length === 0}
          <p class="search-message">No players or teams match “{query.trim()}”.</p>
        {:else}
          {#each items as item, i (item.key)}
            {#if i === 0 && item.kind === 'player'}
              <div class="search-group"><User class="h-3.5 w-3.5" /> Players</div>
            {:else if item.kind === 'team' && (i === 0 || items[i - 1].kind === 'player')}
              <div class="search-group"><Users class="h-3.5 w-3.5" /> Teams</div>
            {/if}
            <!-- eslint-disable svelte/no-navigation-without-resolve -- href comes from resolve() above -->
            <a
              href={item.href}
              id={`search-${item.key}`}
              class="search-item"
              class:search-item-active={i === activeIndex}
              role="option"
              aria-selected={i === activeIndex}
              onmousemove={() => (activeIndex = i)}
              onclick={(event) => {
                event.preventDefault()
                choose(item)
              }}
            >
              {#if item.kind === 'player'}
                {#if item.player.avatarUrl && !brokenImages[item.player.avatarUrl]}
                  <img
                    class="search-thumb search-thumb-round"
                    src={item.player.avatarUrl}
                    alt=""
                    onerror={() => (brokenImages[item.player.avatarUrl!] = true)}
                  />
                {:else}
                  <span class="search-thumb search-thumb-round search-thumb-blank"
                    >{initials(item.player.name)}</span
                  >
                {/if}
                <span class="search-text">
                  <span class="search-title">{item.player.name}</span>
                  <span class="search-sub">
                    {#if item.player.team}
                      {item.player.team}{item.player.teamSeason
                        ? ` · ${item.player.teamSeason}`
                        : ''}
                    {:else}
                      {item.player.riotIds.find((id) => id.includes('#')) ??
                        item.player.riotIds[0] ??
                        'Player'}
                    {/if}
                  </span>
                </span>
              {:else}
                {#if item.team.logoUrl && !brokenImages[item.team.logoUrl]}
                  <img
                    class="search-thumb"
                    src={item.team.logoUrl}
                    alt=""
                    onerror={() => (brokenImages[item.team.logoUrl!] = true)}
                  />
                {:else}
                  <span class="search-thumb search-thumb-blank"
                    >{initials(item.team.tag || item.team.name)}</span
                  >
                {/if}
                <span class="search-text">
                  <span class="search-title">
                    {item.team.name}{#if item.team.tag}<span class="search-tag"
                        >[{item.team.tag}]</span
                      >{/if}
                  </span>
                  <span class="search-sub">{item.team.season ?? 'Team'}</span>
                </span>
              {/if}
            </a>
            <!-- eslint-enable svelte/no-navigation-without-resolve -->
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style src="./SearchPalette.css"></style>
