<script lang="ts">
  import { ChevronDown } from 'lucide-svelte'

  type Option = {
    value: string
    label: string
  }

  let {
    options,
    value = $bindable(''),
    placeholder = 'Select an option...',
    id = '',
    required = false,
    disabled = false,
    compact = false,
    onSelect,
  }: {
    options: Option[]
    value?: string
    placeholder?: string
    id?: string
    required?: boolean
    disabled?: boolean
    compact?: boolean
    onSelect?: (value: string) => void
  } = $props()

  let isOpen = $state(false)
  let containerRef: HTMLDivElement
  let triggerRef: HTMLButtonElement
  let dropdownStyle = $state('')
  let selectedLabel = $derived(options.find((o) => o.value === value)?.label || placeholder)

  function updateDropdownPosition() {
    if (!triggerRef) return
    const rect = triggerRef.getBoundingClientRect()
    const viewportPadding = 8
    const maxHeight = Math.max(160, window.innerHeight - rect.bottom - viewportPadding)
    dropdownStyle = `position: fixed; top: ${rect.bottom + 1}px; left: ${rect.left}px; width: ${rect.width}px; max-height: ${maxHeight}px;`
  }

  function toggle() {
    if (disabled) return
    isOpen = !isOpen
    if (isOpen) {
      updateDropdownPosition()
    }
  }

  function select(option: Option) {
    value = option.value
    onSelect?.(option.value)
    isOpen = false
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      isOpen = false
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

  function handleClickOutside(e: MouseEvent) {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      isOpen = false
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
    <ul class="select-dropdown" role="listbox" style={dropdownStyle}>
      {#each options as option}
        {#if option.value !== undefined && option.value !== null}
          <li
            role="option"
            aria-selected={value === option.value}
            class:selected={value === option.value}
            onclick={() => select(option)}
            onkeydown={(e) => e.key === 'Enter' && select(option)}
            tabindex="0"
          >
            {option.label}
          </li>
        {/if}
      {/each}
    </ul>
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
    list-style: none;
    background-color: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
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

  .select-dropdown li:hover {
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
