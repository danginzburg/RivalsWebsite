<script lang="ts">
  import { page } from '$app/stores'
  import { resolve } from '$app/paths'
  import { ChevronsLeft, ChevronsRight, House, Search } from 'lucide-svelte'

  type Route = '/' | '/scrim-finder' | '/scrim-finder/'

  let isCollapsed = true
  let showText = false

  const navItems = [
    { href: '/' as Route, label: 'Home', icon: House },
    { href: '/scrim-finder' as Route, label: 'Scrim Finder', icon: Search },
  ]

  function getClasses(href: string) {
    const isActive = $page.url.pathname === href
    const base = 'flex items-center rounded-lg transition-colors'
    const spacing = isCollapsed ? 'gap-0 px-3 py-3 justify-center' : 'gap-3 px-4 py-3'
    const active = isActive ? 'font-semibold' : ''
    return `${base} ${spacing} ${active}`
  }

  function getItemStyle(href: string, isHovered: boolean) {
    const isActive = $page.url.pathname === href
    if (isActive) {
      return `color: var(--text); background-color: var(--active);`
    }
    if (isHovered) {
      return `color: var(--text); background-color: var(--hover); opacity: 0.8;`
    }
    return `color: var(--text);`
  }

  function toggleSidebar() {
    if (isCollapsed) {
      showText = false
      isCollapsed = false
      return
    }

    showText = false
    isCollapsed = true
  }

  function handleTransitionEnd(event: TransitionEvent) {
    if (event.propertyName !== 'width') return
    if (!isCollapsed) {
      showText = true
    }
  }
</script>

<nav
  class={isCollapsed
    ? 'min-h-screen w-20 border-r p-4 transition-all'
    : 'min-h-screen w-64 border-r p-4 transition-all'}
  style="background-color: var(--background); border-color: var(--border); color: var(--text);"
  on:transitionend={handleTransitionEnd}
>
  <div class="mb-8 flex items-center justify-center">
    <h1 class={showText ? 'text-xl font-bold' : 'sr-only'} style="color: var(--title);">
      Throw City Rivals
    </h1>
    <button
      type="button"
      class="hover:bg-opacity-20 rounded-lg p-2 transition-colors"
      style="color: var(--text);"
      aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      on:click={toggleSidebar}
    >
      <svelte:component this={isCollapsed ? ChevronsRight : ChevronsLeft} class="h-5 w-5" />
    </button>
  </div>

  <ul class="space-y-2">
    {#each navItems as item (item.href)}
      {@const isActive = $page.url.pathname === item.href}
      {#snippet navLink(isHovered)}
        <a
          href={resolve(item.href)}
          class={getClasses(item.href)}
          title={item.label}
          style={getItemStyle(item.href, isHovered)}
        >
          <svelte:component this={item.icon} class="h-5 w-5" />
          <span class={showText ? '' : 'sr-only'}>{item.label}</span>
        </a>
      {/snippet}
      <li>
        {#if isActive}
          {@render navLink(false)}
        {:else}
          <span
            on:mouseenter={(e) =>
              e.currentTarget.querySelector('a')?.setAttribute('data-hover', 'true')}
            on:mouseleave={(e) => e.currentTarget.querySelector('a')?.removeAttribute('data-hover')}
          >
            <a
              href={resolve(item.href)}
              class={getClasses(item.href)}
              title={item.label}
              style="color: var(--text);"
              on:mouseenter={(e) =>
                (e.currentTarget.style.cssText =
                  'color: var(--text); background-color: var(--hover); opacity: 0.8;')}
              on:mouseleave={(e) => (e.currentTarget.style.cssText = 'color: var(--text);')}
            >
              <svelte:component this={item.icon} class="h-5 w-5" />
              <span class={showText ? '' : 'sr-only'}>{item.label}</span>
            </a>
          </span>
        {/if}
      </li>
    {/each}
  </ul>
</nav>
