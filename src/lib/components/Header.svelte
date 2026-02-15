<script lang="ts">
  import { page } from '$app/stores'
  import { invalidateAll } from '$app/navigation'
  import {
    Users,
    Menu,
    X,
    LogIn,
    LogOut,
    BookOpen,
    Calculator,
    UserPlus,
    Video,
    ChevronDown,
    Trophy,
    BarChart3,
    Calendar,
    MessageSquare,
    Shield,
    Upload,
  } from 'lucide-svelte'
  import rivalsLogo from '$lib/assets/rivals_logo.png'

  let isMobileMenuOpen = $state(false)
  let openDropdown = $state<string | null>(null)
  let isBrandHovered = $state(false)

  // Get user from page data (set by +layout.server.ts)
  const user = $derived($page.data.user)
  const isAdmin = $derived(user?.role === 'admin')

  // Simple nav items (no dropdown)
  const simpleNavItems = [{ href: '/teams', label: 'My Team', icon: Users }]

  // Dropdown menus
  const dropdownMenus = $derived<
    Array<{ id: string; label: string; icon: any; items: DropdownItem[] }>
  >([
    {
      id: 'register',
      label: 'Register',
      icon: UserPlus,
      items: [
        { href: '/signup', label: 'Player Sign Up', icon: UserPlus },
        { href: '/team-registration', label: 'Team Registration', icon: Users },
        { href: '/observer-signup', label: 'Observer Sign Up', icon: Video },
      ],
    },
    {
      id: 'info',
      label: 'Info',
      icon: BookOpen,
      items: [
        { href: '/rulebook', label: 'Rulebook', icon: BookOpen },
        { href: '/matches', label: 'Match Schedule', icon: Calendar },
        { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
        { href: '/stats', label: 'Individual Stats', icon: BarChart3 },
      ],
    },
    {
      id: 'tools',
      label: 'Tools',
      icon: Calculator,
      items: [
        { href: '/team-balance', label: 'Team Balance', icon: Calculator },
        // { href: '#', label: 'Feedback Form', icon: MessageSquare, disabled: true },
        ...($page.data.user?.role === 'admin'
          ? [{ href: '/add-stats', label: 'Add Stats', icon: Upload }]
          : []),
      ],
    },
  ])

  type DropdownItem = {
    href: string
    label: string
    icon: any
    disabled?: boolean
  }

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
    openDropdown = null
  }

  function closeMobileMenu() {
    isMobileMenuOpen = false
    openDropdown = null
  }

  function toggleDropdown(id: string) {
    openDropdown = openDropdown === id ? null : id
  }

  function closeDropdowns() {
    openDropdown = null
  }

  function handleHoverEnter(e: MouseEvent) {
    const target = e.currentTarget as HTMLElement
    target.style.cssText = 'color: var(--text); background-color: var(--hover); opacity: 0.8;'
  }

  function handleHoverLeave(e: MouseEvent) {
    const target = e.currentTarget as HTMLElement
    target.style.cssText = 'color: var(--text);'
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (!target.closest('.dropdown-container')) {
      closeDropdowns()
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<nav
  class="sticky top-0 z-50 w-full"
  style="background-color: var(--background); color: var(--text);"
>
  <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <div class="flex h-16 items-center justify-between">
      <!-- Logo/Brand -->
      <a
        href="/"
        class="flex items-center gap-3"
        style="color: var(--text);"
        onmouseenter={() => (isBrandHovered = true)}
        onmouseleave={() => (isBrandHovered = false)}
      >
        <img src={rivalsLogo} alt="Throw City Rivals logo" class="h-10 w-10 object-contain" />
        <h1
          class="text-xl font-bold"
          style={isBrandHovered ? 'color: var(--hover);' : 'color: var(--title);'}
        >
          Throw City Rivals
        </h1>
      </a>

      <!-- Desktop Navigation -->
      <ul class="hidden md:flex md:items-center md:space-x-1">
        <!-- Simple nav items -->
        {#each simpleNavItems as item (item.href)}
          {@const isActive = $page.url.pathname === item.href}
          {@const Icon = item.icon}
          <li>
            {#if isActive}
              <a
                href={item.href}
                class={getClasses(item.href)}
                title={item.label}
                style={getItemStyle(item.href, false)}
              >
                <Icon class="h-5 w-5" />
                <span>{item.label}</span>
              </a>
            {:else}
              <a
                href={item.href}
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

        <!-- Dropdown menus -->
        {#each dropdownMenus as menu (menu.id)}
          {@const MenuIcon = menu.icon}
          <li class="dropdown-container relative">
            <button
              type="button"
              class="flex items-center gap-1 rounded-lg px-4 py-2 transition-colors"
              style="color: var(--text);"
              onmouseenter={handleHoverEnter}
              onmouseleave={handleHoverLeave}
              onclick={(e) => {
                e.stopPropagation()
                toggleDropdown(menu.id)
              }}
            >
              <MenuIcon class="h-5 w-5" />
              <span>{menu.label}</span>
              <ChevronDown
                class="h-4 w-4 transition-transform {openDropdown === menu.id ? 'rotate-180' : ''}"
              />
            </button>

            {#if openDropdown === menu.id}
              <div
                class="absolute top-full left-0 mt-1 min-w-48 rounded-lg py-2 shadow-lg"
                style="background-color: var(--background); border: 1px solid var(--border);"
              >
                {#each menu.items as item}
                  {@const ItemIcon = item.icon}
                  {#if item.disabled}
                    <span
                      class="flex cursor-not-allowed items-center gap-2 px-4 py-2 opacity-50"
                      style="color: var(--text);"
                    >
                      <ItemIcon class="h-4 w-4" />
                      <span>{item.label}</span>
                      <span class="ml-auto text-xs">Coming Soon</span>
                    </span>
                  {:else}
                    <a
                      href={item.href}
                      class="flex items-center gap-2 px-4 py-2 transition-colors"
                      style="color: var(--text);"
                      onmouseenter={handleHoverEnter}
                      onmouseleave={handleHoverLeave}
                      onclick={closeDropdowns}
                    >
                      <ItemIcon class="h-4 w-4" />
                      <span>{item.label}</span>
                    </a>
                  {/if}
                {/each}
              </div>
            {/if}
          </li>
        {/each}

        <!-- Admin Link (only visible to admins) -->
        {#if isAdmin}
          <li>
            <a
              href="/admin"
              class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors"
              style={$page.url.pathname === '/admin'
                ? 'color: var(--text); background-color: var(--active);'
                : 'color: var(--text);'}
              onmouseenter={handleHoverEnter}
              onmouseleave={handleHoverLeave}
            >
              <Shield class="h-5 w-5" />
              <span>Admin</span>
            </a>
          </li>
        {/if}

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
        <!-- Simple nav items -->
        {#each simpleNavItems as item (item.href)}
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

        <!-- Mobile dropdown menus -->
        {#each dropdownMenus as menu (menu.id)}
          {@const MenuIcon = menu.icon}
          <li class="dropdown-container">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-4 py-2 transition-colors"
              style="color: var(--text);"
              onclick={(e) => {
                e.stopPropagation()
                toggleDropdown(menu.id)
              }}
            >
              <MenuIcon class="h-5 w-5" />
              <span>{menu.label}</span>
              <ChevronDown
                class="ml-auto h-4 w-4 transition-transform {openDropdown === menu.id
                  ? 'rotate-180'
                  : ''}"
              />
            </button>

            {#if openDropdown === menu.id}
              <ul class="mt-1 ml-4 space-y-1 border-l-2 pl-4" style="border-color: var(--accent);">
                {#each menu.items as item}
                  {@const ItemIcon = item.icon}
                  <li>
                    {#if item.disabled}
                      <span
                        class="flex cursor-not-allowed items-center gap-2 rounded-lg px-4 py-2 opacity-50"
                        style="color: var(--text);"
                      >
                        <ItemIcon class="h-4 w-4" />
                        <span>{item.label}</span>
                        <span class="ml-auto text-xs">Coming Soon</span>
                      </span>
                    {:else}
                      <a
                        href={item.href}
                        class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors"
                        style="color: var(--text);"
                        onclick={closeMobileMenu}
                      >
                        <ItemIcon class="h-4 w-4" />
                        <span>{item.label}</span>
                      </a>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}

        <!-- Mobile Admin Link (only visible to admins) -->
        {#if isAdmin}
          <li>
            <a
              href="/admin"
              class="flex items-center gap-2 rounded-lg px-4 py-2 transition-colors"
              style={$page.url.pathname === '/admin'
                ? 'color: var(--text); background-color: var(--active);'
                : 'color: var(--text);'}
              onclick={closeMobileMenu}
            >
              <Shield class="h-5 w-5" />
              <span>Admin</span>
            </a>
          </li>
        {/if}

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
