<script lang="ts">
  import { page } from '$app/stores'
  import { resolve } from '$app/paths'
  import { House, Search, Menu, X } from 'lucide-svelte'
  import rivalsLogo from '$lib/assets/rivals_logo.png'

  type Route = '/' | '/scrim-finder' | '/scrim-finder/'

  let isMobileMenuOpen = false

  const navItems = [
    { href: '/' as Route, label: 'Home', icon: House },
    // { href: '/scrim-finder' as Route, label: 'Scrim Finder', icon: Search },
  ]

  function getClasses(href: string) {
    const isActive = $page.url.pathname === href
    const base = 'flex items-center gap-2 rounded-lg transition-colors px-4 py-2'
    const active = isActive ? 'font-semibold' : ''
    return `${base} ${active}`
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

  function toggleMobileMenu() {
    isMobileMenuOpen = !isMobileMenuOpen
  }

  function closeMobileMenu() {
    isMobileMenuOpen = false
  }
</script>

<nav
  class="sticky top-0 z-50 w-full"
  style="background-color: var(--background); color: var(--text);"
>
  <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <div class="flex h-16 items-center justify-between">
      <!-- Logo/Brand -->
      <div class="flex items-center gap-3">
        <img src={rivalsLogo} alt="Throw City Rivals logo" class="h-10 w-10 object-contain" />
        <h1 class="text-xl font-bold" style="color: var(--title);">Throw City Rivals</h1>
      </div>

      <!-- Desktop Navigation -->
      <ul class="hidden md:flex md:items-center md:space-x-2">
        {#each navItems as item (item.href)}
          {@const isActive = $page.url.pathname === item.href}
          <li>
            {#if isActive}
              <a
                href={resolve(item.href)}
                class={getClasses(item.href)}
                title={item.label}
                style={getItemStyle(item.href, false)}
              >
                <svelte:component this={item.icon} class="h-5 w-5" />
                <span>{item.label}</span>
              </a>
            {:else}
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
                <span>{item.label}</span>
              </a>
            {/if}
          </li>
        {/each}
      </ul>

      <!-- Mobile menu button -->
      <button
        type="button"
        class="hover:bg-opacity-20 rounded-lg p-2 transition-colors md:hidden"
        style="color: var(--text);"
        aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
        on:click={toggleMobileMenu}
      >
        <svelte:component this={isMobileMenuOpen ? X : Menu} class="h-6 w-6" />
      </button>
    </div>
  </div>

  <!-- Mobile menu -->
  {#if isMobileMenuOpen}
    <div class="md:hidden" style="background-color: var(--background);">
      <ul class="space-y-1 px-4 py-3">
        {#each navItems as item (item.href)}
          {@const isActive = $page.url.pathname === item.href}
          <li>
            {#if isActive}
              <a
                href={resolve(item.href)}
                class={getClasses(item.href)}
                title={item.label}
                style={getItemStyle(item.href, false)}
                on:click={closeMobileMenu}
              >
                <svelte:component this={item.icon} class="h-5 w-5" />
                <span>{item.label}</span>
              </a>
            {:else}
              <a
                href={resolve(item.href)}
                class={getClasses(item.href)}
                title={item.label}
                style="color: var(--text);"
                on:mouseenter={(e) =>
                  (e.currentTarget.style.cssText =
                    'color: var(--text); background-color: var(--hover); opacity: 0.8;')}
                on:mouseleave={(e) => (e.currentTarget.style.cssText = 'color: var(--text);')}
                on:click={closeMobileMenu}
              >
                <svelte:component this={item.icon} class="h-5 w-5" />
                <span>{item.label}</span>
              </a>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</nav>
