<script lang="ts">
  import { page } from '$app/stores'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Users, LogIn } from 'lucide-svelte'

  type MyTeam = {
    id: string
    name: string
    tag: string | null
    role: string
    logo_url: string | null
  }

  let { data } = $props()
  const user = $derived($page.data.user)
  const requiresLogin = $derived(Boolean(data.requiresLogin))
  const team = $derived<MyTeam | null>((data.team as MyTeam | null) ?? null)

  function handleLogin() {
    window.location.href = '/auth/login?returnTo=/teams'
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-5xl">
      <div class="mb-6 flex flex-col items-center text-center">
        <Users size={48} class="mb-3" style="color: var(--text);" />
        <h1 class="responsive-title mb-2">My Teams</h1>
        <p class="text-sm" style="color: rgba(255,255,255,0.75);">
          View teams you are part of and open their team pages.
        </p>
      </div>

      <section class="info-card info-card-surface">
        {#if requiresLogin && !user}
          <div class="flex flex-col items-center gap-3 py-4 text-center">
            <p class="text-sm" style="color: rgba(255,255,255,0.75);">Log in to view your teams.</p>
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold"
              style="background: var(--accent); color: var(--text);"
              onclick={handleLogin}
            >
              <LogIn size={16} />
              <span>Login</span>
            </button>
          </div>
        {:else if !team}
          <p class="text-sm" style="color: rgba(255,255,255,0.75);">You are not on a team.</p>
        {:else}
          <a
            href={`/teams/${team.id}`}
            class="flex items-center gap-3 rounded-md border p-3 hover:bg-white/5"
            style="border-color: rgba(255,255,255,0.12);"
          >
            {#if team.logo_url}
              <img
                src={team.logo_url}
                alt="{team.name} logo"
                class="h-10 w-10 rounded object-contain"
              />
            {:else}
              <div class="flex h-10 w-10 items-center justify-center rounded bg-white/10 text-xs">
                N/A
              </div>
            {/if}
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold" style="color: var(--text);">
                {team.name}
                {#if team.tag}
                  <span class="opacity-80"> [{team.tag}]</span>
                {/if}
              </div>
              <div class="text-xs" style="color: rgba(255,255,255,0.72);">Role: {team.role}</div>
            </div>
          </a>
        {/if}
      </section>
    </div>
  </div>
</PageContainer>
