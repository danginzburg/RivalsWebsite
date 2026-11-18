<script lang="ts">
  import { ChevronDown } from 'lucide-svelte'

  type Option = {
    value: string
    label: string
    /**
     * Optional heading this option sits under. Options are rendered in the
     * order given — the heading is drawn whenever it changes — so the caller
     * groups by sorting, and an ungrouped list behaves exactly as before.
     */
    group?: string
  }

  let {
    options,
    value = $bindable(''),
    placeholder = 'Select an option...',
    id = '',
    required = false,
    disabled = false,
    compact = false,
    searchable,
    onSelect,
  }: {
    options: Option[]
    value?: string
    placeholder?: string
    id?: string
    required?: boolean
    disabled?: boolean
    compact?: boolean
    /**
     * Show a type-to-filter box at the top of the list. Defaults to on for
     * long lists (players, teams) and off for short fixed ones.
     */
    searchable?: boolean
    onSelect?: (value: string) => void
  } = $props()

  const SEARCH_THRESHOLD = 10

  let isOpen = $state(false)
  let containerRef: HTMLDivElement
  let triggerRef: HTMLButtonElement
  let searchRef = $state<HTMLInputElement | null>(null)
  let listRef = $state<HTMLUListElement | null>(null)
  let dropdownStyle = $state('')
  let query = $state('')
  let activeIndex = $state(-1)
  let selectedLabel = $derived(options.find((o) => o.value === value)?.label || placeholder)
  const isSearchable = $derived(searchable ?? options.length > SEARCH_THRESHOLD)

  // Case- and accent-insensitive, so "eclair" finds "Éclair".
  const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

  // Every space-separated term must appear in the label; labels starting
  // with the query rank first, otherwise the caller's order is kept. Blank
  // "none" entries only show while nothing is typed.
  const shownOptions = $derived.by(() => {
    const needle = fold(query).trim()
    if (!isSearchable || !needle) return options
    const terms = needle.split(/\s+/)
    const matches = options.filter((o) => {
      if (!o.value) return false
      const label = fold(o.label)
      return terms.every((t) => label.includes(t))
    })
    const starts = matches.filter((o) => fold(o.label).startsWith(needle))
    const rest = matches.filter((o) => !fold(o.label).startsWith(needle))
    return [...starts, ...rest]
  })
  const filtering = $derived(isSearchable && query.trim().length > 0)

  function updateDropdownPosition() {
    if (!triggerRef) return
    const rect = triggerRef.getBoundingClientRect()
    const viewportPadding = 8
    const maxHeight = Math.max(160, window.innerHeight - rect.bottom - viewportPadding)
    dropdownStyle = `position: fixed; top: ${rect.bottom + 1}px; left: ${rect.left}px; width: ${rect.width}px; max-height: ${maxHeight}px;`
  }

  function open(initialQuery = '') {
    if (disabled) return
    isOpen = true
    query = initialQuery
    activeIndex = initialQuery ? 0 : -1
    updateDropdownPosition()
    if (isSearchable) queueMicrotask(() => searchRef?.focus())
  }

  function close() {
    isOpen = false
    query = ''
    activeIndex = -1
  }

  function toggle() {
    if (isOpen) close()
    else open()
  }

  function select(option: Option) {
    value = option.value
    onSelect?.(option.value)
    close()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close()
    } else if (
      isSearchable &&
      !isOpen &&
      e.key.length === 1 &&
      e.key !== ' ' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      // Typing on the focused trigger opens the list already searching.
      e.preventDefault()
      open(e.key)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    } else if (e.key === 'ArrowDown' && isOpen) {
      e.preventDefault()
      const currentIndex = options.findIndex((o) => o.value === value)
      const nextIndex = Math.min(currentIndex + 1, options.length - 1)
      if (options[nextIndex].value) {
        value = options[nextIndex].value
      }
    } else if (e.key === 'ArrowUp' && isOpen) {
      e.preventDefault()
      const currentIndex = options.findIndex((o) => o.value === value)
      const nextIndex = Math.max(currentIndex - 1, 0)
      if (options[nextIndex].value) {
        value = options[nextIndex].value
      }
    }
  }

  function moveActive(delta: number) {
    if (shownOptions.length === 0) return
    const start = activeIndex >= 0 ? activeIndex : shownOptions.findIndex((o) => o.value === value)
    activeIndex = Math.min(Math.max(start + delta, 0), shownOptions.length - 1)
    queueMicrotask(() =>
      listRef
        ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    )
  }

  function handleSearchInput() {
    activeIndex = query.trim() && shownOptions.length > 0 ? 0 : -1
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveActive(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveActive(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const option = shownOptions[activeIndex >= 0 ? activeIndex : 0]
      if (option) select(option)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
      triggerRef?.focus()
    } else if (e.key === 'Tab') {
      close()
    }
  }

  function handleClickOutside(e: MouseEvent) {
    if (isOpen && containerRef && !containerRef.contains(e.target as Node)) {
      close()
    }
  }

  function handleWindowPositionChange() {
    if (isOpen) {
      updateDropdownPosition()
    }
  }
</script>

<svelte:window
  onclick={handleClickOutside}
  onscroll={handleWindowPositionChange}
  onresize={handleWindowPositionChange}
/>

<div class="custom-select" bind:this={containerRef}>
  <!-- Hidden input for form validation -->
  {#if required}
    <input type="hidden" {id} {value} {required} />
  {/if}

  <button
    type="button"
    bind:this={triggerRef}
    class="select-trigger"
    class:compact
    class:placeholder={!value}
    onclick={toggle}
    onkeydown={handleKeydown}
    aria-haspopup="listbox"
    aria-expanded={isOpen}
    {disabled}
  >
    <span class="select-value">{selectedLabel}</span>
    <span class="chevron" class:open={isOpen}>
      <ChevronDown />
    </span>
  </button>

  {#if isOpen}
    <div class="select-dropdown" style={dropdownStyle}>
      {#if isSearchable}
        <div class="search-row">
          <input
            bind:this={searchRef}
            bind:value={query}
            type="text"
            class="search-input"
            placeholder="Type to search…"
            autocomplete="off"
            spellcheck="false"
            aria-label="Search options"
            oninput={handleSearchInput}
            onkeydown={handleSearchKeydown}
          />
        </div>
      {/if}
      <ul role="listbox" bind:this={listRef}>
        {#each shownOptions as option, i (option.value)}
          {#if option.value !== undefined && option.value !== null}
            {#if !filtering && option.group && option.group !== shownOptions[i - 1]?.group}
              <li class="group-header" role="presentation">{option.group}</li>
            {/if}
            <li
              role="option"
              data-index={i}
              aria-selected={value === option.value}
              class:selected={value === option.value}
              class:active={activeIndex === i}
              onclick={() => select(option)}
              onkeydown={(e) => e.key === 'Enter' && select(option)}
              onmouseenter={() => (activeIndex = i)}
              tabindex="0"
            >
              {option.label}
            </li>
          {/if}
        {:else}
          <li class="empty" role="presentation">No matches</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .custom-select {
    position: relative;
    width: 100%;
  }

  .select-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    border-radius: 0.375rem;
    border: 1px solid var(--border);
    background-color: rgba(0, 0, 0, 0.3);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s ease;
  }

  .select-trigger.compact {
    padding: 0.35rem 0.55rem;
    font-size: 0.8125rem;
    border-radius: 0.32rem;
  }

  .select-trigger:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .select-trigger:hover {
    border-color: var(--accent);
  }

  .select-trigger:focus {
    outline: none;
    border-color: var(--hover);
    box-shadow: 0 0 0 2px rgba(120, 67, 145, 0.3);
  }

  .select-trigger.placeholder .select-value {
    color: rgba(255, 255, 255, 0.5);
  }

  .select-value {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    transition: transform 0.2s ease;
    opacity: 0.7;
  }

  .chevron :global(svg) {
    width: 1rem;
    height: 1rem;
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .select-dropdown {
    z-index: 200;
    max-height: 200px;
    overflow-y: auto;
    margin: 0;
    padding: 0.25rem;
    background-color: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
  }

  .select-dropdown ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .search-row {
    position: sticky;
    top: -0.25rem;
    z-index: 1;
    margin: -0.25rem -0.25rem 0.25rem;
    padding: 0.3rem;
    background-color: var(--background);
    border-bottom: 1px solid var(--border);
  }

  .search-input {
    width: 100%;
    padding: 0.35rem 0.55rem;
    font-size: 0.8125rem;
    border-radius: 0.25rem;
    border: 1px solid var(--border);
    background-color: rgba(0, 0, 0, 0.3);
    color: var(--text);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--hover);
  }

  .select-dropdown li {
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    color: var(--text);
    border-radius: 0.25rem;
    cursor: pointer;
    transition:
      background-color 0.1s ease,
      color 0.1s ease;
  }

  .select-dropdown li.group-header {
    padding: 0.5rem 0.75rem 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
    cursor: default;
  }

  .select-dropdown li.empty {
    color: rgba(255, 255, 255, 0.5);
    cursor: default;
  }

  .select-dropdown li.group-header:hover,
  .select-dropdown li.empty:hover {
    background-color: transparent;
  }

  .select-dropdown li:hover,
  .select-dropdown li.active {
    background-color: var(--hover);
  }

  .select-dropdown li.selected {
    background-color: var(--accent);
  }

  .select-dropdown li:focus {
    outline: none;
    background-color: var(--hover);
  }
</style>
