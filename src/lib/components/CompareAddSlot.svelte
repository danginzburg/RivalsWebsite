<script lang="ts">
  import { goto } from '$app/navigation'
  import { tick } from 'svelte'
  import { Plus } from 'lucide-svelte'
  import { prefetchSearchIndex } from '$lib/components/SearchPalette.svelte'
  import { searchIndex, type SearchIndex } from '$lib/search'
  import { externalEvents } from '$lib/stores/external-events.svelte'
  import type { CompareKind } from '$lib/compare'

  /**
   * The empty "+" slot on the compare page. Clicking it turns into a search
   * box for one more player or team of the same kind; picking a result opens
   * the comparison with it added.
   */
  let {
    kind,
    excludeIds,
    hrefWith,
  }: {
    kind: CompareKind
    /** Already in the comparison; left out of the results. */
    excludeIds: string[]
    /** The compare URL with this id added. */
    hrefWith: (id: string) => string
  } = $props()

  let open = $state(false)
  let query = $state('')
  let index = $state<SearchIndex | null>(null)
  let activeIndex = $state(0)
  let inputEl = $state<HTMLInputElement | null>(null)
  let rootEl = $state<HTMLElement | null>(null)
  /** The dropdown is fixed-position so a scrolling table cannot clip it. */
  let dropdownPos = $state<{ left: number; top: number } | null>(null)

  type Option = { id: string; name: string; sub: string | null; image: string | null }

  const options = $derived.by<Option[]>(() => {
    if (!index || !query.trim()) return []
    const excluded = new Set(excludeIds)
    const found = searchIndex(index, query, { includeExternal: externalEvents.show, limit: 12 })
    const list: Option[] =
      kind === 'players'
        ? found.players.map((p) => ({
            id: p.id,
            name: p.name,
            sub: p.team ? `${p.team}${p.teamSeason ? ` · ${p.teamSeason}` : ''}` : null,
            image: p.avatarUrl,
          }))
        : found.teams.map((t) => ({ id: t.id, name: t.name, sub: t.season, image: t.logoUrl }))
    return list.filter((o) => !excluded.has(o.id)).slice(0, 6)
  })

  $effect(() => {
    void query
    activeIndex = 0
  })

  function place() {
    const rect = inputEl?.getBoundingClientRect()
    if (!rect) return
    // Keep the 15rem list on screen when the slot sits near the right edge.
    const listWidth = 15 * 16
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - listWidth - 8))
    dropdownPos = { left, top: rect.bottom + 4 }
  }

  async function start() {
    open = true
    prefetchSearchIndex()
      .then((loaded) => (index = loaded))
      .catch(() => (index = { players: [], teams: [] }))
    await tick()
    inputEl?.focus()
    place()
  }

  function stop() {
    open = false
    query = ''
    dropdownPos = null
  }

  function pick(option: Option | undefined) {
    if (!option) return
    const href = hrefWith(option.id)
    stop()
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- hrefWith builds on resolve()
    goto(href, { noScroll: true })
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      stop()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (options.length) activeIndex = (activeIndex + 1) % options.length
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (options.length) activeIndex = (activeIndex - 1 + options.length) % options.length
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(options[activeIndex])
    }
  }

  function onWindowPointerDown(event: PointerEvent) {
    if (open && rootEl && !rootEl.contains(event.target as Node)) stop()
  }
</script>

<svelte:window
  onpointerdown={onWindowPointerDown}
  onresize={() => open && place()}
  onscroll={() => open && place()}
/>

<span class="add-slot" bind:this={rootEl}>
  {#if !open}
    <button
      type="button"
      class="add-slot-btn"
      title={`Add a ${kind === 'teams' ? 'team' : 'player'}`}
      aria-label={`Add a ${kind === 'teams' ? 'team' : 'player'}`}
      onclick={start}
      onpointerenter={() => prefetchSearchIndex().catch(() => {})}
    >
      <Plus class="h-4 w-4" />
    </button>
  {:else}
    <input
      bind:this={inputEl}
      bind:value={query}
      oninput={place}
      onkeydown={onKeydown}
      class="add-slot-input"
      type="search"
      placeholder={kind === 'teams' ? 'Find a team' : 'Find a player'}
      autocomplete="off"
      spellcheck="false"
      role="combobox"
      aria-expanded={options.length > 0}
      aria-controls="add-slot-options"
    />
    {#if dropdownPos && query.trim()}
      <ul
        id="add-slot-options"
        class="add-slot-list"
        role="listbox"
        style="left: {dropdownPos.left}px; top: {dropdownPos.top}px"
      >
        {#if !index}
          <li class="add-slot-msg">Loading…</li>
        {:else if options.length === 0}
          <li class="add-slot-msg">No matches</li>
        {:else}
          {#each options as option, i (option.id)}
            <li role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                class="add-slot-option"
                class:active={i === activeIndex}
                onpointermove={() => (activeIndex = i)}
                onclick={() => pick(option)}
              >
                {#if option.image}
                  <img
                    src={option.image}
                    alt=""
                    class="add-slot-img"
                    class:round={kind === 'players'}
                    onerror={(e) =>
                      ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
                  />
                {:else}
                  <span class="add-slot-img"></span>
                {/if}
                <span class="add-slot-text">
                  <span class="add-slot-name">{option.name}</span>
                  {#if option.sub}<span class="add-slot-sub">{option.sub}</span>{/if}
                </span>
              </button>
            </li>
          {/each}
        {/if}
      </ul>
    {/if}
  {/if}
</span>

<style src="./CompareAddSlot.css"></style>
