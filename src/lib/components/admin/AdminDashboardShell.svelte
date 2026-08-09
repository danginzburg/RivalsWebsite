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
  import type { Snippet } from 'svelte'

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
</script>

<div class="flex justify-center py-6">
  <div class="page-content">
    <div class="mb-4 flex flex-wrap justify-end gap-2">
      <a
        href={resolve('/admin/leaderboard-import')}
        class="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
        style="background: rgba(234,179,8,0.18); color: #fcd34d;"
      >
        <Upload size={16} />
        Leaderboard Import
      </a>
      <a
        href={resolve('/admin/matches-import')}
        class="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
        style="background: rgba(168,85,247,0.18); color: #d8b4fe;"
      >
        <Upload size={16} />
        Match Import
      </a>
      <a
        href={resolve('/admin/stats-import')}
        class="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
        style="background: rgba(59,130,246,0.2); color: #93c5fd;"
      >
        <Upload size={16} />
        Stats Import
      </a>
    </div>
    <div class="mb-8 flex flex-col items-center">
      <h1 class="responsive-title mb-2 text-center">Admin Dashboard</h1>
      <p class="responsive-text text-center" style="color: var(--text);">
        Manage everything from one place
      </p>
    </div>

    <div class="info-card info-card-surface p-0">
      <!-- Tabs stay on one line and scroll horizontally rather than wrapping. -->
      <div
        class="admin-tabs flex overflow-x-auto border-b"
        style="border-color: rgba(255, 255, 255, 0.12);"
      >
        <button
          type="button"
          class="flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm whitespace-nowrap sm:px-4"
          style={activeTab === 'users'
            ? 'border-color: var(--accent); color: var(--text); background: rgba(255, 255, 255, 0.05);'
            : 'border-color: transparent; color: rgba(255,255,255,0.7);'}
          onclick={() => onTabChange('users')}
        >
          <UserCog size={18} />
          <span>Users ({counts.users})</span>
        </button>
        <button
          type="button"
          class="flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm whitespace-nowrap sm:px-4"
          style={activeTab === 'teams'
            ? 'border-color: var(--accent); color: var(--text); background: rgba(255, 255, 255, 0.05);'
            : 'border-color: transparent; color: rgba(255,255,255,0.7);'}
          onclick={() => onTabChange('teams')}
        >
          <ShieldCheck size={18} />
          <span>Teams ({counts.teams})</span>
        </button>
        <button
          type="button"
          class="flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm whitespace-nowrap sm:px-4"
          style={activeTab === 'matches'
            ? 'border-color: var(--accent); color: var(--text); background: rgba(255, 255, 255, 0.05);'
            : 'border-color: transparent; color: rgba(255,255,255,0.7);'}
          onclick={() => onTabChange('matches')}
        >
          <CalendarDays size={18} />
          <span>Matches ({counts.matches})</span>
        </button>
        <button
          type="button"
          class="flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm whitespace-nowrap sm:px-4"
          style={activeTab === 'seasons'
            ? 'border-color: var(--accent); color: var(--text); background: rgba(255, 255, 255, 0.05);'
            : 'border-color: transparent; color: rgba(255,255,255,0.7);'}
          onclick={() => onTabChange('seasons')}
        >
          <Layers3 size={18} />
          <span>Seasons ({counts.seasons})</span>
        </button>
        <button
          type="button"
          class="flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm whitespace-nowrap sm:px-4"
          style={activeTab === 'accolades'
            ? 'border-color: var(--accent); color: var(--text); background: rgba(255, 255, 255, 0.05);'
            : 'border-color: transparent; color: rgba(255,255,255,0.7);'}
          onclick={() => onTabChange('accolades')}
        >
          <Shield size={18} />
          <span>Accolades ({counts.accolades})</span>
        </button>
        <button
          type="button"
          class="flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm whitespace-nowrap sm:px-4"
          style={activeTab === 'hall-of-fame'
            ? 'border-color: var(--accent); color: var(--text); background: rgba(255, 255, 255, 0.05);'
            : 'border-color: transparent; color: rgba(255,255,255,0.7);'}
          onclick={() => onTabChange('hall-of-fame')}
        >
          <Award size={18} />
          <span>HOF ({counts.hallOfFame})</span>
        </button>
        <button
          type="button"
          class="flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm whitespace-nowrap sm:px-4"
          style={activeTab === 'moderation'
            ? 'border-color: var(--accent); color: var(--text); background: rgba(255, 255, 255, 0.05);'
            : 'border-color: transparent; color: rgba(255,255,255,0.7);'}
          onclick={() => onTabChange('moderation')}
        >
          <Flag size={18} />
          <span>Moderation{counts.moderation > 0 ? ` (${counts.moderation})` : ''}</span>
        </button>
        <button
          type="button"
          class="flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm whitespace-nowrap sm:px-4"
          style={activeTab === 'signups'
            ? 'border-color: var(--accent); color: var(--text); background: rgba(255, 255, 255, 0.05);'
            : 'border-color: transparent; color: rgba(255,255,255,0.7);'}
          onclick={() => onTabChange('signups')}
        >
          <ClipboardList size={18} />
          <span>Signups{counts.signups > 0 ? ` (${counts.signups})` : ''}</span>
        </button>
        <button
          type="button"
          class="ml-auto px-3 py-3 text-sm sm:px-4"
          style="color: var(--text);"
          onclick={onRefresh}
          disabled={isLoading}
          title="Refresh data"
        >
          <RefreshCw size={18} class={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {#if errorMessage}
        <div class="px-4 py-3 text-sm" style="color: #fda4af; background: rgba(244, 63, 94, 0.15);">
          {errorMessage}
        </div>
      {/if}
      {#if successMessage}
        <div
          class="px-4 py-3 text-sm"
          style="color: #4ade80; background: rgba(74, 222, 128, 0.15);"
        >
          {successMessage}
        </div>
      {/if}

      <div class="p-3 sm:p-4">
        {@render children()}
      </div>
    </div>
  </div>
</div>

<style>
  /* Keep the tab strip scrollable without a visible scrollbar eating height. */
  .admin-tabs {
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
</style>
