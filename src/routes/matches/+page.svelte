<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { CalendarDays } from 'lucide-svelte'

  let { data }: PageProps = $props()
  const matches = $derived(data.matches ?? [])
  let searchQuery = $state('')
  let showCompleted = $state(false)

  const filteredMatches = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase()
    return matches.filter((match: { status?: string; team_a?: unknown; team_b?: unknown }) => {
      if (!showCompleted && match.status === 'completed') return false

      if (!query) return true

      const haystack = [teamName(match.team_a), teamName(match.team_b), match.status]
        .join(' ')
        .toLowerCase()

      return haystack.includes(query)
    })
  })

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
    return date.toLocaleString()
  }

  function formatStatus(status: string | null | undefined) {
    if (!status) return 'Unknown'
    return status.charAt(0).toUpperCase() + status.slice(1)
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

      <div class="mb-4 space-y-3">
        <input
          bind:value={searchQuery}
          class="w-full rounded-lg border px-3 py-2 text-sm md:max-w-md"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2); color: var(--text);"
          placeholder="Search teams or match status"
        />
        <label
          class="inline-flex w-full items-center gap-2 text-sm"
          style="color: rgba(255,255,255,0.8);"
        >
          <input bind:checked={showCompleted} type="checkbox" />
          Show completed matches
        </label>
      </div>

      {#if filteredMatches.length === 0}
        <section class="info-card info-card-surface">
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">
            {matches.length === 0
              ? 'No matches available yet.'
              : 'No matches match the current filters.'}
          </p>
        </section>
      {:else}
        <section class="info-card info-card-surface">
          <div class="flex flex-col gap-2">
            {#each filteredMatches as match}
              <article
                class="relative rounded-lg border border-white/12 bg-[rgba(0,0,0,0.2)] p-4 transition-colors duration-150 hover:border-[rgba(147,197,253,0.4)] hover:bg-[rgba(255,255,255,0.04)]"
              >
                <a
                  href={`/matches/${match.id}`}
                  class="absolute inset-0 rounded-lg"
                  aria-label={`Open match ${teamName(match.team_a)} versus ${teamName(match.team_b)}`}
                ></a>

                <div class="relative z-10 flex flex-wrap items-center justify-between gap-2">
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
                        >{formatStatus(match.status)}</span
                      >
                    </div>
                  {/if}
                </div>

                <div class="relative z-10 mt-1 text-xs" style="color: rgba(255,255,255,0.72);">
                  BO{match.best_of} • {formatUtc(match.scheduled_at)}
                  {#if match.status === 'completed'}
                    <span> • Score {match.team_a_score}-{match.team_b_score}</span>
                  {/if}
                </div>

                <div
                  class="pointer-events-none relative z-10 mt-2 inline-flex flex-wrap items-center gap-2"
                >
                  {#if (match.streams ?? []).length > 0}
                    {#each match.streams as stream}
                      <a
                        href={stream.stream_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="pointer-events-auto rounded border border-[rgba(59,130,246,0.18)] bg-[rgba(59,130,246,0.2)] px-2 py-1 text-xs text-[#93c5fd] transition-colors duration-150 hover:border-[rgba(147,197,253,0.4)] hover:bg-[rgba(59,130,246,0.26)] hover:text-[#bfdbfe]"
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
                      style="background: rgba(34,197,94,0.18); color: #86efac;">Completed</span
                    >
                  {/if}
                </div>

                <div class="pointer-events-none relative z-10 mt-3 flex justify-end">
                  <div
                    class="flex h-6 w-6 items-center justify-center rounded-full border text-sm font-semibold opacity-60 transition-opacity"
                    style="border-color: rgba(147,197,253,0.45); color: #93c5fd; background: rgba(59,130,246,0.10);"
                  >
                    +
                  </div>
                </div>
              </article>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  </div>
</PageContainer>
