<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Trophy, Users, CalendarDays, BarChart3 } from 'lucide-svelte'

  let { data }: PageProps = $props()

  const team = $derived(data.team)
  const roster = $derived(data.roster ?? [])
  const upcomingMatches = $derived(data.upcomingMatches ?? [])
  const matchHistory = $derived(data.matchHistory ?? [])
  const leaderboard = $derived(data.leaderboard ?? null)
  const activeSeason = $derived(data.activeSeason ?? null)

  function formatUtc(value: string | null | undefined) {
    if (!value) return 'Date TBD'
    const date = new Date(value)
    return `${date.toLocaleString(undefined, { timeZone: 'UTC' })} UTC`
  }

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }

  function teamTag(value: unknown) {
    if (!value) return null
    if (Array.isArray(value)) return (value[0] as { tag?: string } | undefined)?.tag ?? null
    return (value as { tag?: string }).tag ?? null
  }

  function opponentFor(
    match: { team_a_id?: string; team_b_id?: string; team_a?: unknown; team_b?: unknown } | null,
    teamId: string
  ) {
    return match?.team_a_id === teamId ? match?.team_b : match?.team_a
  }

  function scoreFor(
    match: {
      team_a_id?: string
      team_a_score?: unknown
      team_b_score?: unknown
    } | null,
    teamId: string
  ) {
    const a = Number(match?.team_a_score ?? 0)
    const b = Number(match?.team_b_score ?? 0)
    if (match?.team_a_id === teamId) return { us: a, them: b }
    return { us: b, them: a }
  }

  function fmt(value: unknown, digits = 1) {
    const num = Number(value)
    return Number.isFinite(num) ? num.toFixed(digits) : '—'
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-6xl space-y-4">
      <section
        class="rounded-lg border p-5"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div class="flex items-center gap-4">
          {#if team.logo_url}
            <img
              src={team.logo_url}
              alt="{team.name} logo"
              class="h-20 w-20 rounded object-contain"
            />
          {:else}
            <div
              class="flex h-20 w-20 items-center justify-center rounded border"
              style="border-color: rgba(255,255,255,0.12);"
            >
              <Users size={34} style="color: var(--text);" />
            </div>
          {/if}
          <div>
            <h1 class="responsive-title">{team.name}{team.tag ? ` [${team.tag}]` : ''}</h1>
            {#if team.org || team.created_at}
              <p class="text-sm" style="color: rgba(255,255,255,0.72);">
                {#if team.org}{team.org}{/if}
                {#if team.created_at}
                  <span
                    >{team.org ? ' • ' : ''}Created {new Date(
                      team.created_at
                    ).toLocaleDateString()}</span
                  >
                {/if}
              </p>
            {/if}
            {#if team.about}
              <p class="mt-2 max-w-3xl text-sm" style="color: rgba(255,255,255,0.82);">
                {team.about}
              </p>
            {/if}
          </div>
        </div>
      </section>

      {#if leaderboard}
        <section
          class="rounded-lg border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="mb-3 flex items-center gap-2">
            <Trophy size={18} />
            <h2
              class="text-sm font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.8);"
            >
              Current Standings
            </h2>
          </div>
          <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.04);"
            >
              <div class="text-xs uppercase" style="color: rgba(255,255,255,0.65);">Rank</div>
              <div class="text-xl font-semibold" style="color: var(--text);">
                #{leaderboard.rank}
              </div>
            </div>
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.04);"
            >
              <div class="text-xs uppercase" style="color: rgba(255,255,255,0.65);">Points</div>
              <div class="text-xl font-semibold" style="color: var(--text);">
                {leaderboard.points}
              </div>
            </div>
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.04);"
            >
              <div class="text-xs uppercase" style="color: rgba(255,255,255,0.65);">Series</div>
              <div class="text-xl font-semibold" style="color: var(--text);">
                {leaderboard.wins}-{leaderboard.losses}
              </div>
            </div>
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.04);"
            >
              <div class="text-xs uppercase" style="color: rgba(255,255,255,0.65);">Round Diff</div>
              <div class="text-xl font-semibold" style="color: var(--text);">
                {leaderboard.round_diff}
              </div>
            </div>
          </div>
        </section>
      {/if}

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section
          class="rounded-lg border p-4"
          style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
        >
          <div class="mb-3 flex items-center gap-2">
            <Users size={18} />
            <h2
              class="text-sm font-semibold tracking-wide uppercase"
              style="color: rgba(255,255,255,0.8);"
            >
              Roster
            </h2>
          </div>

          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            {#each roster as player}
              <svelte:element
                this={player.profile_id ? 'a' : 'div'}
                href={player.profile_id ? `/players/${player.profile_id}` : undefined}
                class="rounded-md border p-3 transition-colors hover:bg-white/5"
                style="border-color: rgba(255,255,255,0.10);"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="font-semibold" style="color: var(--text);">
                      {player.riot_id_base ??
                        player.display_name ??
                        player.player_name ??
                        player.email ??
                        'Player'}
                    </div>
                    <div class="text-xs uppercase" style="color: rgba(255,255,255,0.62);">
                      {player.role}
                    </div>
                  </div>
                  {#if player.stats}
                    <div class="text-right text-xs" style="color: rgba(255,255,255,0.78);">
                      <div>ACS {fmt(player.stats.acs, 0)}</div>
                      <div>KD {fmt(player.stats.kd, 2)}</div>
                    </div>
                  {/if}
                </div>
                {#if player.stats}
                  <div class="mt-2 text-xs" style="color: rgba(255,255,255,0.68);">
                    ADR {fmt(player.stats.adr, 0)}
                  </div>
                {/if}
              </svelte:element>
            {/each}
          </div>
          {#if !activeSeason}
            <div class="mt-3 text-sm" style="color: rgba(255,255,255,0.62);">
              Player season stats will appear once an active season exists and season stats are
              imported.
            </div>
          {/if}
        </section>

        <section class="space-y-4">
          <div
            class="rounded-lg border p-4"
            style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
          >
            <div class="mb-3 flex items-center gap-2">
              <Trophy size={18} />
              <h2
                class="text-sm font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.8);"
              >
                Season Snapshot
              </h2>
            </div>
            {#if leaderboard}
              <div class="space-y-2 text-sm" style="color: rgba(255,255,255,0.82);">
                <div>Active season: {activeSeason?.name ?? 'No active season'}</div>
                <div>Latest batch: {leaderboard.batch?.display_name ?? 'Imported snapshot'}</div>
                {#if leaderboard.batch?.as_of_date}
                  <div>As of: {leaderboard.batch.as_of_date}</div>
                {/if}
              </div>
            {:else}
              <div class="text-sm" style="color: rgba(255,255,255,0.72);">
                No current season standings yet.
              </div>
            {/if}
          </div>

          <div
            class="rounded-lg border p-4"
            style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
          >
            <div class="mb-3 flex items-center gap-2">
              <CalendarDays size={18} />
              <h2
                class="text-sm font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.8);"
              >
                Upcoming Matches
              </h2>
            </div>
            {#if upcomingMatches.length === 0}
              <div class="text-sm" style="color: rgba(255,255,255,0.72);">
                No upcoming matches listed.
              </div>
            {:else}
              <div class="space-y-2">
                {#each upcomingMatches as match}
                  {@const opp = opponentFor(match, team.id)}
                  <a
                    href={`/matches/${match.id}`}
                    class="block rounded-md border p-3 transition-colors hover:bg-white/5"
                    style="border-color: rgba(255,255,255,0.10);"
                  >
                    <div class="font-semibold" style="color: var(--text);">vs {teamName(opp)}</div>
                    <div class="text-xs" style="color: rgba(255,255,255,0.68);">
                      {formatUtc(match.scheduled_at)} • {match.status}
                    </div>
                  </a>
                {/each}
              </div>
            {/if}
          </div>
        </section>
      </div>

      <section
        class="rounded-lg border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div class="mb-3 flex items-center gap-2">
          <BarChart3 size={18} />
          <h2
            class="text-sm font-semibold tracking-wide uppercase"
            style="color: rgba(255,255,255,0.8);"
          >
            Match History
          </h2>
        </div>
        {#if matchHistory.length === 0}
          <div class="text-sm" style="color: rgba(255,255,255,0.72);">
            No completed matches yet.
          </div>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead>
                <tr class="text-xs uppercase" style="color: rgba(255,255,255,0.75);">
                  <th class="px-3 py-2">Opponent</th>
                  <th class="px-3 py-2">When</th>
                  <th class="px-3 py-2">Score</th>
                  <th class="px-3 py-2">Tag</th>
                </tr>
              </thead>
              <tbody>
                {#each matchHistory as match}
                  {@const opp = opponentFor(match, team.id)}
                  {@const score = scoreFor(match, team.id)}
                  <tr class="border-t" style="border-color: rgba(255,255,255,0.10);">
                    <td class="px-3 py-2 font-semibold" style="color: var(--text);">
                      <a href={`/matches/${match.id}`} class="underline" style="color: var(--text);"
                        >{teamName(opp)}</a
                      >
                    </td>
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.9);">
                      {formatUtc(match.scheduled_at)}
                    </td>
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.9);"
                      >{score.us}-{score.them}</td
                    >
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.9);">
                      {teamTag(opp) ? `[${teamTag(opp)}]` : '—'}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    </div>
  </div>
</PageContainer>
