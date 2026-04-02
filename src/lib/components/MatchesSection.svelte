<script lang="ts">
  import { CalendarDays } from 'lucide-svelte'

  let { matches }: { matches: any[] } = $props()

  function formatUtc(value: string | null | undefined) {
    if (!value) return 'TBD'
    const date = new Date(value)
    return `${date.toLocaleString(undefined, { timeZone: 'UTC' })} UTC`
  }

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }
</script>

<div class="matches-section-wrapper relative z-10">
  <div class="w-full max-w-5xl">
    <div class="mb-3 flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <CalendarDays size={18} />
        <div
          class="text-xs font-semibold tracking-wide uppercase"
          style="color: rgba(255,255,255,0.75);"
        >
          Matches
        </div>
      </div>
      <a
        href="/matches"
        class="rounded-md px-3 py-2 text-xs font-semibold"
        style="background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.85);"
      >
        View All
      </a>
    </div>

    {#if (matches ?? []).length === 0}
      <div
        class="rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <p class="text-sm" style="color: rgba(255,255,255,0.72);">No matches yet.</p>
      </div>
    {:else}
      <div
        class="overflow-x-auto rounded-md border"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <table class="w-full text-left text-sm">
          <thead>
            <tr
              class="border-b"
              style="border-color: rgba(255,255,255,0.12); color: rgba(255,255,255,0.75);"
            >
              <th class="px-3 py-2">Match</th>
              <th class="px-3 py-2">When</th>
              <th class="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {#each matches.slice(0, 8) as match}
              <tr class="border-b" style="border-color: rgba(255,255,255,0.08);">
                <td class="px-3 py-2 font-semibold" style="color: var(--text);">
                  <a href={`/matches/${match.id}`} class="underline" style="color: var(--text);">
                    {teamName(match.team_a)} vs {teamName(match.team_b)}
                  </a>
                </td>
                <td class="px-3 py-2" style="color: rgba(255,255,255,0.82);">
                  {formatUtc(match.scheduled_at ?? match.ended_at)}
                </td>
                <td class="px-3 py-2" style="color: rgba(255,255,255,0.82);">{match.status}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>
