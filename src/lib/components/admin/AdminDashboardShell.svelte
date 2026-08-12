<script lang="ts">
  import {
    RefreshCw,
    UserCog,
    ShieldCheck,
    CalendarDays,
    Upload,
    Layers3,
    Shield,
    Award,
    Flag,
    ClipboardList,
  } from 'lucide-svelte'
  import { resolve } from '$app/paths'

  import type { AdminTabId } from '$lib/admin/types'
  import type { ComponentType, Snippet } from 'svelte'

  interface Props {
    activeTab: AdminTabId
    counts: {
      users: number
      teams: number
      matches: number
      seasons: number
      accolades: number
      hallOfFame: number
      moderation: number
      signups: number
    }
    isLoading: boolean
    errorMessage: string | null
    successMessage: string | null
    onTabChange: (tab: AdminTabId) => void
    onRefresh: () => void
    children: Snippet
  }

  let {
    activeTab,
    counts,
    isLoading,
    errorMessage,
    successMessage,
    onTabChange,
    onRefresh,
    children,
  }: Props = $props()

  /*
   * The tab strip used to be nine hand-written buttons that drifted apart
   * whenever one was edited. Driving it from data keeps every tab identical
   * and makes the count badges consistent.
   */
  type Tab = {
    id: AdminTabId
    label: string
    icon: ComponentType
    count: number
    /** Counts that mean "needs attention" are hidden when they are zero. */
    hideZero?: boolean
  }

  const tabs = $derived<Tab[]>([
    { id: 'users', label: 'Users', icon: UserCog, count: counts.users },
    { id: 'teams', label: 'Teams', icon: ShieldCheck, count: counts.teams },
    { id: 'matches', label: 'Matches', icon: CalendarDays, count: counts.matches },
    { id: 'seasons', label: 'Seasons', icon: Layers3, count: counts.seasons },
    { id: 'accolades', label: 'Accolades', icon: Shield, count: counts.accolades },
    { id: 'hall-of-fame', label: 'HOF', icon: Award, count: counts.hallOfFame },
    { id: 'moderation', label: 'Moderation', icon: Flag, count: counts.moderation, hideZero: true },
    { id: 'signups', label: 'Signups', icon: ClipboardList, count: counts.signups, hideZero: true },
  ])

  const imports = [
    { href: '/admin/leaderboard-import', label: 'Leaderboard', variant: 'admin-btn-warn' },
    { href: '/admin/matches-import', label: 'Matches', variant: 'admin-btn-accent' },
    { href: '/admin/stats-import', label: 'Stats', variant: 'admin-btn-info' },
  ] as const
</script>

<div class="admin-page">
  <div class="page-content">
    <header class="admin-masthead">
      <div class="min-w-0">
        <p class="admin-eyebrow">Control panel</p>
        <h1 class="admin-title">Admin Dashboard</h1>
      </div>

      <div class="admin-masthead-actions">
        <!-- Import links read as one group so they are not mistaken for tabs. -->
        <div class="admin-import-group">
          <span class="admin-import-label"><Upload size={14} /> Import</span>
          {#each imports as item (item.href)}
            <a href={resolve(item.href)} class="admin-btn admin-btn-sm {item.variant}">
              {item.label}
            </a>
          {/each}
        </div>
        <button
          type="button"
          class="admin-btn admin-btn-neutral admin-refresh"
          onclick={onRefresh}
          disabled={isLoading}
          title="Refresh data"
          aria-label="Refresh data"
        >
          <RefreshCw size={16} class={isLoading ? 'animate-spin' : ''} />
          <span class="admin-refresh-text">Refresh</span>
        </button>
      </div>
    </header>

    <div class="admin-panel">
      <!-- Tabs stay on one line and scroll horizontally rather than wrapping. -->
      <div class="admin-tabs" role="tablist">
        {#each tabs as tab (tab.id)}
          {@const Icon = tab.icon}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            class="admin-tab"
            class:admin-tab-active={activeTab === tab.id}
            onclick={() => onTabChange(tab.id)}
          >
            <Icon size={17} />
            <span>{tab.label}</span>
            {#if !tab.hideZero || tab.count > 0}
              <span class="admin-tab-count">{tab.count}</span>
            {/if}
          </button>
        {/each}
      </div>

      {#if errorMessage}
        <div class="admin-banner admin-banner-error">{errorMessage}</div>
      {/if}
      {#if successMessage}
        <div class="admin-banner admin-banner-success">{successMessage}</div>
      {/if}

      <div class="admin-panel-body">
        {@render children()}
      </div>
    </div>
  </div>
</div>

<style>
  .admin-page {
    display: flex;
    justify-content: center;
    padding: 1.5rem 0 2.5rem;
  }

  /* Masthead */
  .admin-masthead {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  .admin-eyebrow {
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent-text);
  }

  .admin-title {
    font-size: 1.875rem;
    font-weight: 700;
    line-height: 1.15;
    color: var(--title);
  }

  .admin-masthead-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .admin-import-group {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.3125rem 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.625rem;
    background: rgba(0, 0, 0, 0.22);
  }

  .admin-import-label {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    padding-right: 0.375rem;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.55);
    white-space: nowrap;
  }

  .admin-refresh-text {
    display: none;
  }

  /* Panel */
  .admin-panel {
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1rem;
    background: rgba(0, 0, 0, 0.3);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
    overflow: hidden;
  }

  /*
   * Scrollable strip rather than a wrapping block: nine tabs stacked into
   * three rows pushed the actual content below the fold on a phone.
   */
  .admin-tabs {
    display: flex;
    overflow-x: auto;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
    -webkit-overflow-scrolling: touch;
  }

  .admin-tabs::-webkit-scrollbar {
    height: 3px;
  }

  .admin-tabs::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }

  .admin-tab {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.4375rem;
    padding: 0.75rem 0.875rem;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: rgba(255, 255, 255, 0.62);
    font-size: 0.8125rem;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition:
      color 0.15s,
      background 0.15s,
      border-color 0.15s;
  }

  .admin-tab:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.04);
  }

  .admin-tab-active {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
    border-bottom-color: var(--hover);
  }

  .admin-tab-count {
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.625rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .admin-tab-active .admin-tab-count {
    background: var(--hover);
    color: var(--text);
  }

  .admin-banner {
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .admin-banner-error {
    background: rgba(244, 63, 94, 0.16);
    color: #fda4af;
  }

  .admin-banner-success {
    background: rgba(74, 222, 128, 0.16);
    color: #86efac;
  }

  .admin-panel-body {
    padding: 0.875rem;
  }

  @media (min-width: 640px) {
    .admin-title {
      font-size: 2.25rem;
    }

    .admin-panel-body {
      padding: 1.25rem;
    }

    .admin-refresh-text {
      display: inline;
    }
  }

  @media (max-width: 640px) {
    .admin-page {
      padding: 1rem 0 2rem;
    }

    /* Actions get their own full-width row instead of squeezing the title. */
    .admin-masthead-actions {
      width: 100%;
    }

    .admin-import-group {
      flex: 1;
      justify-content: space-between;
    }
  }
</style>
