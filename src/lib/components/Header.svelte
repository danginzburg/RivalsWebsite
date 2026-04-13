<script lang="ts">
  import { page } from '$app/stores'
  import { invalidateAll } from '$app/navigation'
  import {
    Menu,
    X,
    LogIn,
    LogOut,
    BookOpen,
    Calculator,
    Trophy,
    BarChart3,
    Calendar,
    Users,
    User,
    UserCog,
  } from 'lucide-svelte'
  import rivalsLogo from '$lib/assets/rivals_logo.png'

  let isMobileMenuOpen = $state(false)
  let isBrandHovered = $state(false)
  let openDesktopGroup = $state<string | null>(null)
  let desktopNavRef = $state<HTMLElement | null>(null)

  const user = $derived($page.data.user)
  const isAdmin = $derived(user?.role === 'admin')
  const activePickemHref = $derived(
    $page.data.activePickemSeasonCode ? `/pickems/${$page.data.activePickemSeasonCode}` : null
  )

  const navItems = $derived.by(() => {
    const items: Array<{ href: string; label: string; icon: any }> = [
      { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
      { href: '/matches', label: 'Matches', icon: Calendar },
      { href: '/rulebook', label: 'Rulebook', icon: BookOpen },
      { href: '/stats', label: 'Stats', icon: BarChart3 },
      { href: '/team-balance', label: 'Calculator', icon: Calculator },
      { href: '/teams', label: 'Teams', icon: Users },
    ]

    if (activePickemHref) {
      items.splice(1, 0, { href: activePickemHref, label: "Pick'ems", icon: Trophy })
    }

    if (user) {
      items.push({ href: '/account', label: 'Account', icon: User })
    }

    if (isAdmin) {
      items.push({ href: '/admin', label: 'Admin', icon: UserCog })
    }

    return items
  })

  const desktopGroups = $derived.by(() => {
    const groups = [
      {
        label: 'Competition',
        items: navItems.filter(
          (item) =>
            ['/leaderboard', '/matches', '/teams'].includes(item.href) ||
            item.href === activePickemHref
        ),
      },
      {
        label: 'Resources',
        items: navItems.filter((item) =>
          ['/rulebook', '/stats', '/team-balance'].includes(item.href)
        ),
      },
    ]

    return groups.filter((group) => group.items.length > 0)
  })

  const desktopStandaloneItems = $derived.by(() =>
    navItems.filter(
      (item) =>
        !['/leaderboard', '/matches', '/teams', '/rulebook', '/stats', '/team-balance'].includes(
          item.href
        ) && item.href !== activePickemHref
    )
  )

  function handleLogin() {
    window.location.href = '/auth/login'
  }

  async function handleLogout() {
    await window.fetch('/auth/logout')
    await invalidateAll()
  }

  function getClasses(href: string) {
    const isActive = $page.url.pathname === href
    const base =
      'flex min-w-[112px] items-center justify-center gap-2 rounded-lg px-5 py-2 transition-colors'
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

  function isGroupActive(items: Array<{ href: string }>) {
    return items.some((item) => $page.url.pathname === item.href)
  }

  function toggleMobileMenu() {
    isMobileMenuOpen = !isMobileMenuOpen
  }

  function toggleDesktopGroup(label: string) {
    openDesktopGroup = openDesktopGroup === label ? null : label
  }

  function closeDesktopGroup() {
    openDesktopGroup = null
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

  function handleWindowClick(e: MouseEvent) {
    if (desktopNavRef && !desktopNavRef.contains(e.target as Node)) {
      closeDesktopGroup()
    }
  }
</script>

<svelte:window onclick={handleWindowClick} />

<nav
  class="sticky top-0 z-50 w-full"
  style="background-color: var(--background); color: var(--text);"
>
  <div class="mx-auto max-w-[96rem] px-4 sm:px-6 lg:px-8 xl:px-10">
    <div class="flex h-16 items-center justify-between">
      <!-- Logo/Brand -->
      <a
        href="/"
        class="flex min-w-0 flex-shrink items-center gap-3 pr-3"
        style="color: var(--text);"
        onmouseenter={() => (isBrandHovered = true)}
        onmouseleave={() => (isBrandHovered = false)}
      >
        <img src={rivalsLogo} alt="Throw City Rivals logo" class="h-10 w-10 object-contain" />
        <h1
          class="text-base font-bold whitespace-nowrap sm:text-lg xl:text-xl"
          style={isBrandHovered ? 'color: var(--hover);' : 'color: var(--title);'}
        >
          Throw City Rivals
        </h1>
      </a>

      <!-- Desktop Navigation -->
      <ul class="desktop-nav items-center space-x-2" bind:this={desktopNavRef}>
        {#each desktopGroups as group (group.label)}
          {@const groupActive = isGroupActive(group.items)}
          <li class="relative">
            <button
              type="button"
              class={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${groupActive ? 'font-semibold' : ''}`}
              style={groupActive || openDesktopGroup === group.label
                ? 'color: var(--text); background-color: var(--active);'
                : 'color: var(--text); background-color: transparent;'}
              onclick={(e) => {
                e.stopPropagation()
                toggleDesktopGroup(group.label)
              }}
            >
              <span>{group.label}</span>
              <span class="text-xs opacity-70">▼</span>
            </button>
            {#if openDesktopGroup === group.label}
              <div
                class="absolute right-0 mt-2 min-w-[220px] rounded-xl border p-2 shadow-2xl"
                style="border-color: rgba(255,255,255,0.12); background: rgba(10,10,10,0.98);"
              >
                {#each group.items as item (item.href)}
                  {@const Icon = item.icon}
                  <a
                    href={item.href}
                    class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
                    style={$page.url.pathname === item.href
                      ? 'color: var(--text); background-color: var(--active);'
                      : 'color: var(--text);'}
                    onclick={closeDesktopGroup}
                  >
                    <Icon class="h-4 w-4" />
                    <span>{item.label}</span>
                  </a>
                {/each}
              </div>
            {/if}
          </li>
        {/each}

        {#each desktopStandaloneItems as item (item.href)}
          {@const isActive = $page.url.pathname === item.href}
          {@const Icon = item.icon}
          <li>
            <a
              href={item.href}
              class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors"
              title={item.label}
              style={isActive ? getItemStyle(item.href, false) : 'color: var(--text);'}
              onmouseenter={isActive ? undefined : handleHoverEnter}
              onmouseleave={isActive ? undefined : handleHoverLeave}
            >
              <Icon class="h-5 w-5" />
              <span>{item.label}</span>
            </a>
          </li>
        {/each}

        <!-- Auth Button -->
        <li>
          {#if user}
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors"
              style="color: var(--text); background-color: var(--tertiary-background);"
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
              style="color: var(--text); background-color: var(--tertiary-background);"
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
        class="mobile-menu-toggle hover:bg-opacity-20 rounded-lg p-2 transition-colors"
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
    <div class="mobile-menu-panel" style="background-color: var(--background);">
      <ul class="space-y-1 px-4 py-3">
        {#each navItems as item (item.href)}
          {@const isActive = $page.url.pathname === item.href}
          {@const Icon = item.icon}
          <li>
            <a
              href={item.href}
              class={getClasses(item.href)}
              title={item.label}
              style={isActive ? getItemStyle(item.href, false) : 'color: var(--text);'}
              onclick={closeMobileMenu}
            >
              <Icon class="h-5 w-5" />
              <span>{item.label}</span>
            </a>
          </li>
        {/each}

        <!-- Mobile Auth Button -->
        <li>
          {#if user}
            <button
              type="button"
              class="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 transition-colors"
              style="color: var(--text); background-color: var(--tertiary-background);"
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
              class="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 transition-colors"
              style="color: var(--text); background-color: var(--tertiary-background);"
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

<style>
  .desktop-nav {
    display: flex;
  }

  .mobile-menu-toggle,
  .mobile-menu-panel {
    display: none;
  }

  @media (max-width: 1350px) {
    .desktop-nav {
      display: none;
    }

    .mobile-menu-toggle,
    .mobile-menu-panel {
      display: block;
    }
  }
</style>
