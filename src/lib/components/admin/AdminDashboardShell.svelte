<script lang="ts">
  import {
    RefreshCw,
    UserCog,
    ShieldCheck,
    CalendarDays,
    Upload,
    Layers3,
    Swords,
    Shield,
    Award,
    Flag,
    ClipboardList,
    Bell,
    FileText,
    Calculator,
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
      pickems: number
      accolades: number
      hallOfFame: number
      moderation: number
      signups: number
    }
    /** Total pending-approval items across every tab; drives the masthead cue. */
    pendingTotal: number
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
    pendingTotal,
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
    { id: 'pickems', label: "Pick'em", icon: Swords, count: counts.pickems },
    { id: 'accolades', label: 'Accolades', icon: Shield, count: counts.accolades },
    { id: 'hall-of-fame', label: 'HOF', icon: Award, count: counts.hallOfFame },
    { id: 'moderation', label: 'Moderation', icon: Flag, count: counts.moderation, hideZero: true },
    { id: 'signups', label: 'Signups', icon: ClipboardList, count: counts.signups, hideZero: true },
  ])

  const imports = [
    { href: '/admin/standings', label: 'Standings', variant: 'admin-btn-warn' },
    { href: '/admin/matches-import', label: 'Matches', variant: 'admin-btn-accent' },
    { href: '/admin/stats-import', label: 'Stats', variant: 'admin-btn-info' },
    { href: '/admin/riot-identities', label: 'Identities', variant: 'admin-btn-neutral' },
  ] as const
</script>

<div class="admin-page">
  <div class="page-content">
    <header class="admin-masthead">
      <div class="min-w-0">
        <p class="admin-eyebrow">Control panel</p>
        <h1 class="admin-title">Admin Dashboard</h1>
        {#if pendingTotal > 0}
          <!-- Jumps to whichever tab is waiting (Moderation takes precedence). -->
          <button
            type="button"
            class="admin-pending-pill"
            onclick={() => onTabChange(counts.moderation > 0 ? 'moderation' : 'signups')}
            title="Items awaiting your review"
          >
            <Bell size={13} />
            {pendingTotal} pending {pendingTotal === 1 ? 'item' : 'items'}
          </button>
        {/if}
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
        <a
          href={resolve('/admin/content')}
          class="admin-btn admin-btn-neutral admin-refresh"
          title="Edit the rulebook and FAQ"
        >
          <FileText size={16} />
          <span class="admin-refresh-text">Rulebook & FAQ</span>
        </a>
        <!-- Admins can reach this page even while it is hidden from the header. -->
        <a
          href={resolve('/team-balance')}
          class="admin-btn admin-btn-neutral admin-refresh"
          title="Open the team calculator"
          aria-label="Team calculator"
        >
          <Calculator size={16} />
          <span class="admin-refresh-text">Calculator</span>
        </a>
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

<style src="./AdminDashboardShell.css"></style>
