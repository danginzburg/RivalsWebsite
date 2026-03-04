<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { CalendarDays, RadioTower, Swords } from 'lucide-svelte'

  let { data } = $props()

  const match = $derived(data.match)

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
      <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <Swords size={36} style="color: var(--text);" />
          <div>
            <h1 class="responsive-title">{teamName(match.team_a)} vs {teamName(match.team_b)}</h1>
            <p class="text-sm" style="color: rgba(255,255,255,0.72);">
              BO{match.best_of} • {formatUtc(match.scheduled_at)}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span
            class="rounded-full px-2 py-1 text-xs font-bold"
            style="background: rgba(255,255,255,0.12); color: var(--text);"
          >
            {match.status}
          </span>
          {#if match.status === 'completed'}
            <span
              class="rounded-full px-2 py-1 text-xs font-bold"
              style="background: rgba(34,197,94,0.18); color: #86efac;"
            >
              Final {match.team_a_score}-{match.team_b_score}
            </span>
          {/if}
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section
          class="rounded-md border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="mb-3 flex items-center gap-2">
            <CalendarDays size={18} />
            <h2
              class="text-sm font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.8);"
            >
              Details
            </h2>
          </div>

          <div class="space-y-2 text-sm" style="color: rgba(255,255,255,0.78);">
            <div>
              <span style="color: rgba(255,255,255,0.55);">Scheduled:</span>
              <span class="ml-2" style="color: var(--text);">{formatUtc(match.scheduled_at)}</span>
            </div>
            {#if match.started_at}
              <div>
                <span style="color: rgba(255,255,255,0.55);">Started:</span>
                <span class="ml-2" style="color: var(--text);">{formatUtc(match.started_at)}</span>
              </div>
            {/if}
            {#if match.ended_at}
              <div>
                <span style="color: rgba(255,255,255,0.55);">Ended:</span>
                <span class="ml-2" style="color: var(--text);">{formatUtc(match.ended_at)}</span>
              </div>
            {/if}
          </div>
        </section>

        <section
          class="rounded-md border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="mb-3 flex items-center gap-2">
            <RadioTower size={18} />
            <h2
              class="text-sm font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.8);"
            >
              Streams
            </h2>
          </div>

          {#if (match.streams ?? []).length === 0}
            <p class="text-sm" style="color: rgba(255,255,255,0.72);">No streams listed yet.</p>
          {:else}
            <div class="flex flex-col gap-2">
              {#each match.streams as stream}
                <a
                  href={stream.stream_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="rounded-md border p-3 text-sm"
                  style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18); color: var(--text);"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div>
                      <strong>{stream.platform}</strong>
                      {#if stream.is_primary}
                        <span
                          class="ml-2 rounded-full px-2 py-0.5 text-xs"
                          style="background: rgba(59,130,246,0.2); color: #93c5fd;">Primary</span
                        >
                      {/if}
                    </div>
                    <span
                      class="rounded-full px-2 py-0.5 text-xs"
                      style="background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.8);"
                      >{stream.status}</span
                    >
                  </div>
                  <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.65);">
                    {stream.stream_url}
                  </div>
                </a>
              {/each}
            </div>
          {/if}
        </section>
      </div>
    </div>
  </div>
</PageContainer>
