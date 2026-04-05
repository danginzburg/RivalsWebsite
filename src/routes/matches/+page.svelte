<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { goto } from '$app/navigation'
  import { CalendarDays } from 'lucide-svelte'

  let { data } = $props()
  const matches = $derived(data.matches ?? [])

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }

  function teamLogo(value: unknown) {
    if (!value) return null
    if (Array.isArray(value))
      return (value[0] as { logo_url?: string } | undefined)?.logo_url ?? null
    return (value as { logo_url?: string }).logo_url ?? null
  }

  function formatUtc(value: string | null | undefined) {
    if (!value) return 'Date TBD'
    const date = new Date(value)
    return `${date.toLocaleString(undefined, { timeZone: 'UTC' })} UTC`
  }

  function openMatch(matchId: string) {
    goto(`/matches/${matchId}`)
  }

  function handleCardKeydown(event: KeyboardEvent, matchId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openMatch(matchId)
    }
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl">
      <div class="mb-6 flex items-center gap-3">
        <CalendarDays size={36} style="color: var(--text);" />
        <div>
          <h1 class="responsive-title">Matches</h1>
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">
            Upcoming, live, and completed matches.
          </p>
        </div>
      </div>

      {#if matches.length === 0}
        <section class="info-card info-card-surface">
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">No matches available yet.</p>
        </section>
      {:else}
        <section class="info-card info-card-surface">
          <div class="flex flex-col gap-2">
            {#each matches as match}
              <div
                class="cursor-pointer rounded-lg border border-white/12 bg-[rgba(0,0,0,0.2)] p-4 transition-colors duration-150 hover:border-[rgba(147,197,253,0.4)] hover:bg-[rgba(255,255,255,0.04)]"
                role="link"
                tabindex="0"
                aria-label={`Open match ${teamName(match.team_a)} versus ${teamName(match.team_b)}`}
                onclick={() => openMatch(match.id)}
                onkeydown={(event) => handleCardKeydown(event, match.id)}
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-4 text-base" style="color: var(--text);">
                    <div class="flex items-center gap-3">
                      {#if teamLogo(match.team_a)}
                        <img
                          src={teamLogo(match.team_a)}
                          alt="{teamName(match.team_a)} logo"
                          class="h-12 w-12 rounded object-contain"
                        />
                      {/if}
                      <strong>{teamName(match.team_a)}</strong>
                    </div>
                    <span>vs</span>
                    <div class="flex items-center gap-3">
                      {#if teamLogo(match.team_b)}
                        <img
                          src={teamLogo(match.team_b)}
                          alt="{teamName(match.team_b)} logo"
                          class="h-12 w-12 rounded object-contain"
                        />
                      {/if}
                      <strong>{teamName(match.team_b)}</strong>
                    </div>
                  </div>
                  {#if match.status !== 'completed'}
                    <div class="flex items-center gap-2">
                      <span
                        class="rounded-full px-2 py-1 text-xs font-bold"
                        style="background: rgba(255,255,255,0.12); color: var(--text);"
                        >{match.status}</span
                      >
                    </div>
                  {/if}
                </div>

                <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.72);">
                  BO{match.best_of} • {formatUtc(match.scheduled_at)}
                  {#if match.status === 'completed'}
                    <span> • Score {match.team_a_score}-{match.team_b_score}</span>
                  {/if}
                </div>

                <div class="mt-2 flex flex-wrap items-center gap-2">
                  {#if (match.streams ?? []).length > 0}
                    {#each match.streams as stream}
                      <a
                        href={stream.stream_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="rounded border border-[rgba(59,130,246,0.18)] bg-[rgba(59,130,246,0.2)] px-2 py-1 text-xs text-[#93c5fd] transition-colors duration-150 hover:border-[rgba(147,197,253,0.4)] hover:bg-[rgba(59,130,246,0.26)] hover:text-[#bfdbfe]"
                        onclick={(event) => event.stopPropagation()}
                        onkeydown={(event) => event.stopPropagation()}
                      >
                        {stream.metadata?.display_name || stream.platform}{stream.is_primary
                          ? ' (Primary)'
                          : ''}
                      </a>
                    {/each}
                  {/if}
                  {#if match.status === 'completed'}
                    <span
                      class="rounded-full px-2 py-1 text-xs font-bold"
                      style="background: rgba(34,197,94,0.18); color: #86efac;">completed</span
                    >
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  </div>
</PageContainer>
