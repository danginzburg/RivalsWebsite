<script lang="ts">
  import { page } from '$app/stores'
  import { resolve } from '$app/paths'
  import { goto, invalidateAll } from '$app/navigation'
  import { House, Search, Menu, X, LogIn, LogOut, BookOpen } from 'lucide-svelte'
  import rivalsLogo from '$lib/assets/rivals_logo.png'

  type Route = '/' | '/scrim-finder' | '/scrim-finder/' | '/rulebook'

  let isMobileMenuOpen = $state(false)

  // Get user from page data (set by +layout.server.ts)
  const user = $derived($page.data.user)

  const navItems = [
    { href: '/' as Route, label: 'Home', icon: House },
    { href: '/rulebook' as Route, label: 'Rulebook', icon: BookOpen },
    // { href: '/scrim-finder' as Route, label: 'Scrim Finder', icon: Search },
  ]

  function handleLogin() {
    window.location.href = '/auth/login'
  }

  async function handleLogout() {
    await fetch('/auth/logout')
    await invalidateAll()
  }

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

  function handleHoverEnter(e: MouseEvent) {
    const target = e.currentTarget as HTMLElement
    target.style.cssText = 'color: var(--text); background-color: var(--hover); opacity: 0.8;'
  }

  function handleHoverLeave(e: MouseEvent) {
    const target = e.currentTarget as HTMLElement
    target.style.cssText = 'color: var(--text);'
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
          {@const Icon = item.icon}
          <li>
            {#if isActive}
              <a
                href={resolve(item.href)}
                class={getClasses(item.href)}
                title={item.label}
                style={getItemStyle(item.href, false)}
              >
                <Icon class="h-5 w-5" />
                <span>{item.label}</span>
              </a>
            {:else}
              <a
                href={resolve(item.href)}
                class={getClasses(item.href)}
                title={item.label}
                style="color: var(--text);"
                onmouseenter={handleHoverEnter}
                onmouseleave={handleHoverLeave}
              >
                <Icon class="h-5 w-5" />
                <span>{item.label}</span>
              </a>
            {/if}
          </li>
        {/each}

        <!-- Auth Button -->
        <li>
          {#if user}
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors"
              style="color: var(--text);"
              title="Logout"
              onmouseenter={handleHoverEnter}
              onmouseleave={handleHoverLeave}
              onclick={handleLogout}
            >
              <LogOut class="h-5 w-5" />
              <span>Logout</span>
            </button>
          {:else}
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors"
              style="color: var(--text);"
              title="Login"
              onmouseenter={handleHoverEnter}
              onmouseleave={handleHoverLeave}
              onclick={handleLogin}
            >
              <LogIn class="h-5 w-5" />
              <span>Login</span>
            </button>
          {/if}
        </li>
      </ul>

      <!-- Mobile menu button -->
      <button
        type="button"
        class="hover:bg-opacity-20 rounded-lg p-2 transition-colors md:hidden"
        style="color: var(--text);"
        aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
        onclick={toggleMobileMenu}
      >
        {#if isMobileMenuOpen}
          <X class="h-6 w-6" />
        {:else}
          <Menu class="h-6 w-6" />
        {/if}
      </button>
    </div>
  </div>

  <!-- Mobile menu -->
  {#if isMobileMenuOpen}
    <div class="md:hidden" style="background-color: var(--background);">
      <ul class="space-y-1 px-4 py-3">
        {#each navItems as item (item.href)}
          {@const isActive = $page.url.pathname === item.href}
          {@const Icon = item.icon}
          <li>
            {#if isActive}
              <a
                href={resolve(item.href)}
                class={getClasses(item.href)}
                title={item.label}
                style={getItemStyle(item.href, false)}
                onclick={closeMobileMenu}
              >
                <Icon class="h-5 w-5" />
                <span>{item.label}</span>
              </a>
            {:else}
              <a
                href={resolve(item.href)}
                class={getClasses(item.href)}
                title={item.label}
                style="color: var(--text);"
                onmouseenter={handleHoverEnter}
                onmouseleave={handleHoverLeave}
                onclick={closeMobileMenu}
              >
                <Icon class="h-5 w-5" />
                <span>{item.label}</span>
              </a>
            {/if}
          </li>
        {/each}

        <!-- Mobile Auth Button -->
        <li>
          {#if user}
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-4 py-2 transition-colors"
              style="color: var(--text);"
              title="Logout"
              onmouseenter={handleHoverEnter}
              onmouseleave={handleHoverLeave}
              onclick={() => {
                closeMobileMenu()
                handleLogout()
              }}
            >
              <LogOut class="h-5 w-5" />
              <span>Logout</span>
            </button>
          {:else}
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-4 py-2 transition-colors"
              style="color: var(--text);"
              title="Login"
              onmouseenter={handleHoverEnter}
              onmouseleave={handleHoverLeave}
              onclick={() => {
                closeMobileMenu()
                handleLogin()
              }}
            >
              <LogIn class="h-5 w-5" />
              <span>Login</span>
            </button>
          {/if}
        </li>
      </ul>
    </div>
  {/if}
</nav>
