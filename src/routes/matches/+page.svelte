<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { CalendarDays } from 'lucide-svelte'

  let { data } = $props()
  const matches = $derived(data.matches ?? [])

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }

  function formatUtc(value: string | null | undefined) {
    if (!value) return 'Date TBD'
    const date = new Date(value)
    return `${date.toLocaleString(undefined, { timeZone: 'UTC' })} UTC`
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
              <article
                class="rounded-md border p-3"
                style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="text-sm" style="color: var(--text);">
                    <strong>{teamName(match.team_a)}</strong>
                    <span> vs </span>
                    <strong>{teamName(match.team_b)}</strong>
                  </div>
                  <div class="flex items-center gap-2">
                    <a
                      href={`/matches/${match.id}`}
                      class="rounded px-2 py-1 text-xs"
                      style="background: rgba(255,255,255,0.10); color: var(--text);"
                    >
                      View
                    </a>
                    <span
                      class="rounded-full px-2 py-1 text-xs font-bold"
                      style="background: rgba(255,255,255,0.12); color: var(--text);"
                      >{match.status}</span
                    >
                  </div>
                </div>

                <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.72);">
                  BO{match.best_of} • {formatUtc(match.scheduled_at)}
                  {#if match.status === 'completed'}
                    <span> • Score {match.team_a_score}-{match.team_b_score}</span>
                  {/if}
                </div>

                {#if (match.streams ?? []).length > 0}
                  <div class="mt-2 flex flex-wrap gap-2">
                    {#each match.streams as stream}
                      <a
                        href={stream.stream_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="rounded px-2 py-1 text-xs"
                        style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                      >
                        {stream.platform}{stream.is_primary ? ' (Primary)' : ''}
                      </a>
                    {/each}
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  </div>
</PageContainer>
