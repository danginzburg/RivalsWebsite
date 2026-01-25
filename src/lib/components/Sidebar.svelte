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
    const base = 'flex items-center rounded-lg transition-colors hover:bg-gray-200'
    const spacing = isCollapsed ? 'gap-0 px-3 py-3 justify-center' : 'gap-3 px-4 py-3'
    const active = isActive ? 'bg-gray-200 font-semibold' : ''
    return `${base} ${spacing} ${active}`
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
    ? 'min-h-screen w-20 border-r border-gray-300 bg-gray-100 p-4 transition-all'
    : 'min-h-screen w-64 border-r border-gray-300 bg-gray-100 p-4 transition-all'}
  on:transitionend={handleTransitionEnd}
>
  <div class="mb-8 flex items-center justify-center">
    <h1 class={showText ? 'text-xl font-bold text-gray-900' : 'sr-only'}>Throw City Rivals</h1>
    <button
      type="button"
      class="rounded-lg p-2 text-gray-700 transition-colors hover:bg-gray-200"
      aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      on:click={toggleSidebar}
    >
      <svelte:component this={isCollapsed ? ChevronsRight : ChevronsLeft} class="h-5 w-5" />
    </button>
  </div>

  <ul class="space-y-2">
    {#each navItems as item (item.href)}
      <li>
        <a href={resolve(item.href)} class={getClasses(item.href)} title={item.label}>
          <svelte:component this={item.icon} class="h-5 w-5" />
          <span class={showText ? '' : 'sr-only'}>{item.label}</span>
        </a>
      </li>
    {/each}
  </ul>
</nav>
