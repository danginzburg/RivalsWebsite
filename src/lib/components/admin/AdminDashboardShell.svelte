<script lang="ts">
  import { RefreshCw, UserCog, ShieldCheck, CalendarDays, Upload, Layers3 } from 'lucide-svelte'

  import type { AdminTabId } from '$lib/admin/types'
  import type { Snippet } from 'svelte'

  interface Props {
    activeTab: AdminTabId
    counts: {
      users: number
      teams: number
      matches: number
      seasons: number
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

<div class="flex justify-center px-4 py-8">
  <div class="w-full max-w-6xl">
    <div class="mb-4 flex flex-wrap justify-end gap-2">
      <a
        href="/admin/leaderboard-import"
        class="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
        style="background: rgba(234,179,8,0.18); color: #fcd34d;"
      >
        <Upload size={16} />
        Leaderboard Import
      </a>
      <a
        href="/admin/matches-import"
        class="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
        style="background: rgba(168,85,247,0.18); color: #d8b4fe;"
      >
        <Upload size={16} />
        Match Import
      </a>
      <a
        href="/admin/stats-import"
        class="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
        style="background: rgba(59,130,246,0.2); color: #93c5fd;"
      >
        <Upload size={16} />
        Stats Import
      </a>
    </div>
    <div class="mb-8 flex flex-col items-center">
      <UserCog size={48} style="color: var(--text);" class="mb-4" />
      <h1 class="responsive-title mb-2 text-center">Admin Dashboard</h1>
      <p class="responsive-text text-center" style="color: var(--text);">
        Manage everything from one place
      </p>
    </div>

    <div class="info-card info-card-surface p-0">
      <div class="flex border-b" style="border-color: rgba(255, 255, 255, 0.12);">
        <button
          type="button"
          class="flex items-center gap-2 border-b-2 px-3 py-3 text-sm sm:px-5 sm:text-base"
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
          class="flex items-center gap-2 border-b-2 px-3 py-3 text-sm sm:px-5 sm:text-base"
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
          class="flex items-center gap-2 border-b-2 px-3 py-3 text-sm sm:px-5 sm:text-base"
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
          class="flex items-center gap-2 border-b-2 px-3 py-3 text-sm sm:px-5 sm:text-base"
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
