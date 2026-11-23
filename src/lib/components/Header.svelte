<script lang="ts">
  import { page } from '$app/stores'
  import { invalidateAll } from '$app/navigation'
  import { resolve } from '$app/paths'
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
    CalendarClock,
    HelpCircle,
    User,
    UserCog,
    Target,
    ClipboardList,
    Award,
    Search,
  } from 'lucide-svelte'
  import DiscordIcon from '$lib/components/icons/DiscordIcon.svelte'
  import NotificationBell from '$lib/components/NotificationBell.svelte'
  import SearchPalette, { prefetchSearchIndex } from '$lib/components/SearchPalette.svelte'
  import rivalsLogo from '$lib/assets/rivals_logo.webp'

  let isMobileMenuOpen = $state(false)
  let isBrandHovered = $state(false)
  let isSearchOpen = $state(false)

  function openSearch() {
    isMobileMenuOpen = false
    isSearchOpen = true
  }

  function warmSearch() {
    prefetchSearchIndex().catch(() => {})
  }

  const user = $derived($page.data.user)
  const isAdmin = $derived(user?.role === 'admin')
  const hasActivePickem = $derived($page.data.hasActivePickem ?? false)
  // While an external event is the active season, hide the Rivals-only tabs
  // (Calculator, Rulebook, FAQ, Signup) — that event hosts them elsewhere.
  const isExternalSeason = $derived($page.data.activeSeasonKind === 'external')
  // Signups for the next season can open while an external event is active, so
  // the Signup tab follows the signup season instead.
  const signupsOpen = $derived($page.data.signupsOpen ?? false)
  // Rulebook and FAQ stay out of the nav until an admin publishes them.
  const rulebookPublished = $derived($page.data.rulebookPublished ?? false)
  const faqPublished = $derived($page.data.faqPublished ?? false)
  const unreadNotifications = $derived($page.data.unreadNotifications ?? 0)
  const adminQueue = $derived($page.data.adminQueue ?? [])

  type NavHref =
    | '/'
    | '/matches'
    | '/events'
    | '/faq'
    | '/hall-of-fame'
    | '/leaderboard'
    | '/pickems'
    | '/rulebook'
    | '/signup'
    | '/stats'
    | '/team-balance'
    | '/teams'
    | '/account'
    | '/admin'

  type NavItem = { href: NavHref; label: string; icon: typeof Trophy }

  /** Main navigation — rendered flat, no grouping. */
  const navItems = $derived.by<NavItem[]>(() => [
    { href: '/matches', label: 'Matches', icon: Calendar },
    { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
    ...(hasActivePickem ? [{ href: '/pickems' as NavHref, label: "Pick'ems", icon: Target }] : []),
    { href: '/events', label: 'Events', icon: CalendarClock },
    { href: '/hall-of-fame', label: 'Hall of Fame', icon: Award },
    { href: '/stats', label: 'Stats', icon: BarChart3 },
    ...(isExternalSeason
      ? []
      : [
          { href: '/team-balance' as NavHref, label: 'Calculator', icon: Calculator },
          ...(rulebookPublished
            ? [{ href: '/rulebook' as NavHref, label: 'Rulebook', icon: BookOpen }]
            : []),
          ...(faqPublished ? [{ href: '/faq' as NavHref, label: 'FAQ', icon: HelpCircle }] : []),
        ]),
    ...(isExternalSeason && !signupsOpen
      ? []
      : [{ href: '/signup' as NavHref, label: 'Signup', icon: ClipboardList }]),
  ])

  /** Icon-only items pinned to the right of the nav. */
  const utilityItems = $derived.by<NavItem[]>(() => {
    const items: NavItem[] = []
    if (user) items.push({ href: '/account', label: 'Account', icon: User })
    if (isAdmin) items.push({ href: '/admin', label: 'Admin', icon: UserCog })
    return items
  })

  /** Mobile menu shows everything in one list. */
  const mobileItems = $derived([...navItems, ...utilityItems])

  function handleLogin() {
    window.location.href = '/auth/login'
  }

  async function handleLogout() {
    await window.fetch('/auth/logout')
    await invalidateAll()
  }

  function isPathActive(href: string) {
    const path = $page.url.pathname
    if (href === '/matches') return path.startsWith('/matches')
    if (href === '/pickems') return path.startsWith('/pickems')
    if (href === '/events') return path.startsWith('/events')
    return path === href
  }

  function toggleMobileMenu() {
    isMobileMenuOpen = !isMobileMenuOpen
  }

  function closeMobileMenu() {
    isMobileMenuOpen = false
  }
</script>

<nav class="site-nav">
  <div class="nav-inner">
    <!-- Brand -->
    <a
      href={resolve('/')}
      class="brand"
      onmouseenter={() => (isBrandHovered = true)}
      onmouseleave={() => (isBrandHovered = false)}
    >
      <img src={rivalsLogo} alt="Rivals logo" class="brand-logo" />
      <span class="brand-name" style={isBrandHovered ? 'color: var(--accent-text);' : ''}
        >Rivals</span
      >
    </a>

    <!-- Desktop navigation -->
    <div class="desktop-nav">
      <ul class="nav-links">
        {#each navItems as item (item.href)}
          <li>
            <a
              href={resolve(item.href)}
              class="nav-link"
              class:nav-link-active={isPathActive(item.href)}
            >
              {item.label}
            </a>
          </li>
        {/each}
      </ul>

      <div class="nav-utility">
        <button
          type="button"
          class="icon-btn"
          title="Search (Ctrl K)"
          aria-label="Search players and teams"
          onclick={openSearch}
          onmouseenter={warmSearch}
          onfocus={warmSearch}
        >
          <Search class="h-5 w-5" />
        </button>

        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
        <a
          href="https://discord.gg/JpTYg2662C"
          target="_blank"
          rel="noopener noreferrer"
          class="icon-btn"
          title="Discord"
          aria-label="Discord"
        >
          <DiscordIcon size={19} />
        </a>

        {#if user}
          <NotificationBell initialUnread={unreadNotifications} initialAdminQueue={adminQueue} />
        {/if}

        {#each utilityItems as item (item.href)}
          {@const Icon = item.icon}
          <a
            href={resolve(item.href)}
            class="icon-btn"
            class:icon-btn-active={isPathActive(item.href)}
            title={item.label}
            aria-label={item.label}
          >
            <Icon class="h-5 w-5" />
          </a>
        {/each}

        {#if user}
          <button
            type="button"
            class="icon-btn icon-btn-auth"
            title="Logout"
            aria-label="Logout"
            onclick={handleLogout}
          >
            <LogOut class="h-5 w-5" />
          </button>
        {:else}
          <button
            type="button"
            class="icon-btn icon-btn-auth"
            title="Login"
            aria-label="Login"
            onclick={handleLogin}
          >
            <LogIn class="h-5 w-5" />
          </button>
        {/if}
      </div>
    </div>

    <!-- Mobile cluster: search and the bell (when signed in) sit beside the menu toggle. -->
    <div class="mobile-bell">
      <button
        type="button"
        class="icon-btn"
        aria-label="Search players and teams"
        onclick={openSearch}
        ontouchstart={warmSearch}
      >
        <Search class="h-5 w-5" />
      </button>
      {#if user}
        <NotificationBell initialUnread={unreadNotifications} initialAdminQueue={adminQueue} />
      {/if}
    </div>

    <!-- Mobile menu button -->
    <button
      type="button"
      class="mobile-menu-toggle"
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

  <!-- Mobile menu -->
  {#if isMobileMenuOpen}
    <div class="mobile-menu-panel">
      <ul class="mobile-list">
        {#each mobileItems as item (item.href)}
          {@const Icon = item.icon}
          <li>
            <a
              href={resolve(item.href)}
              class="mobile-link"
              class:mobile-link-active={isPathActive(item.href)}
              onclick={closeMobileMenu}
            >
              <Icon class="h-5 w-5" />
              <span>{item.label}</span>
            </a>
          </li>
        {/each}

        <li>
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a
            href="https://discord.gg/JpTYg2662C"
            target="_blank"
            rel="noopener noreferrer"
            class="mobile-link"
            onclick={closeMobileMenu}
          >
            <DiscordIcon size={19} />
            <span>Discord</span>
          </a>
        </li>

        <li>
          {#if user}
            <button
              type="button"
              class="mobile-link mobile-link-auth"
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
              class="mobile-link mobile-link-auth"
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

<SearchPalette bind:open={isSearchOpen} />

<style src="./Header.css"></style>
