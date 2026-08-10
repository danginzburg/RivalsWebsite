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
    Award,
    HelpCircle,
    Users,
    User,
    UserCog,
    Target,
    ClipboardList,
  } from 'lucide-svelte'
  import DiscordIcon from '$lib/components/icons/DiscordIcon.svelte'
  import rivalsLogo from '$lib/assets/rivals_logo.webp'

  let isMobileMenuOpen = $state(false)
  let isBrandHovered = $state(false)

  const user = $derived($page.data.user)
  const isAdmin = $derived(user?.role === 'admin')
  const hasActivePickem = $derived($page.data.hasActivePickem ?? false)

  type NavHref =
    | '/'
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
    { href: '/', label: 'Matches', icon: Calendar },
    { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
    { href: '/teams', label: 'Teams', icon: Users },
    ...(hasActivePickem ? [{ href: '/pickems' as NavHref, label: "Pick'ems", icon: Target }] : []),
    { href: '/events', label: 'Events', icon: CalendarClock },
    { href: '/hall-of-fame', label: 'Hall of Fame', icon: Award },
    { href: '/stats', label: 'Stats', icon: BarChart3 },
    { href: '/team-balance', label: 'Calculator', icon: Calculator },
    { href: '/rulebook', label: 'Rulebook', icon: BookOpen },
    { href: '/faq', label: 'FAQ', icon: HelpCircle },
    { href: '/signup', label: 'Signup', icon: ClipboardList },
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
    // The matches feed lives at the root, so individual match pages count as active too.
    if (href === '/') return path === '/' || path.startsWith('/matches')
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
      <span class="brand-name" style={isBrandHovered ? 'color: var(--hover);' : ''}>Rivals</span>
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

<style>
  .site-nav {
    position: sticky;
    top: 0;
    z-index: 50;
    width: 100%;
    background-color: var(--background);
    color: var(--text);
  }

  .nav-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    height: 3.5rem;
    /* Use the full viewport width so the flat nav has room to breathe. */
    padding: 0 1rem;
  }

  /* Brand */
  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    color: var(--text);
    text-decoration: none;
  }

  .brand-logo {
    height: 2rem;
    width: 2rem;
    object-fit: contain;
  }

  .brand-name {
    font-size: 1.0625rem;
    font-weight: 700;
    white-space: nowrap;
    color: var(--title);
    transition: color 0.15s;
  }

  /* Desktop nav */
  .desktop-nav {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
    justify-content: flex-end;
    min-width: 0;
  }

  .nav-links {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    list-style: none;
    margin: 0;
    padding: 0;
    min-width: 0;
  }

  .nav-link {
    display: block;
    padding: 0.4375rem 0.625rem;
    border-radius: 0.375rem;
    font-size: 0.8125rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.72);
    text-decoration: none;
    white-space: nowrap;
    transition:
      color 0.15s,
      background-color 0.15s;
  }

  .nav-link:hover {
    color: var(--text);
    background-color: rgba(255, 255, 255, 0.07);
  }

  .nav-link-active {
    color: var(--text);
    background-color: var(--active);
    font-weight: 600;
  }

  .nav-link-active:hover {
    background-color: var(--hover);
  }

  /* Icon-only utility cluster */
  .nav-utility {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding-left: 0.625rem;
    margin-left: 0.25rem;
    border-left: 1px solid rgba(255, 255, 255, 0.12);
    flex-shrink: 0;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.125rem;
    height: 2.125rem;
    border-radius: 0.375rem;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.72);
    cursor: pointer;
    transition:
      color 0.15s,
      background-color 0.15s;
  }

  .icon-btn:hover {
    color: var(--text);
    background-color: rgba(255, 255, 255, 0.07);
  }

  .icon-btn-active {
    color: var(--text);
    background-color: var(--active);
  }

  .icon-btn-active:hover {
    background-color: var(--hover);
  }

  .icon-btn-auth {
    background-color: var(--tertiary-background);
    color: var(--text);
  }

  .icon-btn-auth:hover {
    background-color: var(--hover);
  }

  /* Mobile */
  .mobile-menu-toggle,
  .mobile-menu-panel {
    display: none;
  }

  .mobile-menu-toggle {
    padding: 0.5rem;
    border-radius: 0.5rem;
    border: none;
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }

  .mobile-list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    list-style: none;
    margin: 0;
    padding: 0.5rem 0.75rem 0.75rem;
  }

  .mobile-link {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.625rem 0.75rem;
    border-radius: 0.5rem;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.9375rem;
    text-decoration: none;
    cursor: pointer;
    text-align: left;
  }

  .mobile-link:hover {
    background-color: rgba(255, 255, 255, 0.07);
    color: var(--text);
  }

  .mobile-link-active {
    background-color: var(--active);
    color: var(--text);
    font-weight: 600;
  }

  .mobile-link-auth {
    justify-content: center;
    background-color: var(--tertiary-background);
    color: var(--text);
    margin-top: 0.375rem;
  }

  /* Tighten spacing before the nav has to collapse. */
  @media (max-width: 1500px) {
    .nav-link {
      padding: 0.4375rem 0.5rem;
      font-size: 0.78125rem;
    }
  }

  @media (max-width: 1280px) {
    .desktop-nav {
      display: none;
    }

    .mobile-menu-toggle,
    .mobile-menu-panel {
      display: block;
    }
  }
</style>
