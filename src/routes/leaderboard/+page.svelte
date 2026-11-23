<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Search, Lock } from 'lucide-svelte'
  import ArchiveBracket from '$lib/components/ArchiveBracket.svelte'
  import StandingsZonesEditor from '$lib/components/StandingsZonesEditor.svelte'
  import { resolve } from '$app/paths'
  import {
    EMPTY_STANDINGS_CONFIG,
    ZONE_TONE_COLORS,
    zoneForTeam,
    zoneRangeLabel,
    type StandingsZone,
  } from '$lib/seasons/standingsZones'

  let { data }: PageProps = $props()

  const rows = $derived(data.rows ?? [])
  // The page is scoped to the running season; between seasons there is none.
  const season = $derived(data.season ?? null)
  const myTeam = $derived(data.myTeam ?? null)
  const seeds = $derived((data.seeds ?? {}) as Record<string, number>)
  const zones = $derived(data.zones ?? EMPTY_STANDINGS_CONFIG)
  const bracket = $derived(data.bracket ?? null)
  const isAdmin = $derived(data.viewer?.isAdmin ?? false)
  const asOf = $derived(data.batch?.as_of_date ?? null)

  let editingZones = $state(false)
  let search = $state('')

  type Row = (typeof rows)[number]
  /** A row that has an entry in the current standings. */
  type RankedRow = Row & { stats: NonNullable<Row['stats']> }

  const q = $derived(search.trim().toLowerCase())

  const allRanked = $derived(rows.filter((r): r is RankedRow => r.stats != null))
  const ranked = $derived(
    q
      ? allRanked.filter((r) =>
          [r.name, r.tag, r.org].filter(Boolean).join(' ').toLowerCase().includes(q)
        )
      : allRanked
  )

  const myRank = $derived(
    myTeam ? (allRanked.find((r) => r.id === myTeam.id)?.stats.rank ?? null) : null
  )

  /**
   * Standings grouped by zone, in zone order: each group gets one small label
   * row instead of a coloured stripe on every row. Teams outside every zone
   * (or a season with no zones) fall into an unlabelled group.
   */
  type Group = {
    zone: StandingsZone | null
    dim: boolean
    rows: (RankedRow & { locked: boolean })[]
  }
  const groups = $derived.by<Group[]>(() => {
    const byZone = new Map<string | null, Group>()
    const lastZone = zones.zones.at(-1)
    // Only an open-ended bottom zone reads as "out"; dimming a lone zone would dim everything.
    const dimId = zones.zones.length > 1 && lastZone?.to == null ? lastZone?.id : undefined
    for (const zone of zones.zones) byZone.set(zone.id, { zone, dim: zone.id === dimId, rows: [] })
    byZone.set(null, { zone: null, dim: false, rows: [] })
    for (const row of ranked) {
      const placed = zoneForTeam(zones, row.id, row.stats.rank)
      byZone.get(placed.zone?.id ?? null)!.rows.push({ ...row, locked: placed.locked })
    }
    return [...byZone.values()].filter((g) => g.rows.length > 0)
  })

  function ordinal(n: number) {
    const suffix = ['th', 'st', 'nd', 'rd']
    const v = n % 100
    return n + (suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0])
  }

  const asOfLabel = $derived(
    asOf
      ? new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(String(asOf)))
      : null
  )

  const metaLine = $derived(
    [
      asOfLabel ? `Standings as of ${asOfLabel}` : 'Standings',
      allRanked.length ? `${allRanked.length} teams` : null,
      bracket ? 'Playoffs in progress' : null,
    ]
      .filter(Boolean)
      .join(' · ')
  )

  const playoffNote = $derived.by(() => {
    if (!bracket) return ''
    const total = bracket.slots.length
    const played = bracket.slots.filter((s) => s.winnerId).length
    const teamCount = Object.keys(seeds).length
    return [
      'Double elimination',
      teamCount ? `${teamCount} teams` : null,
      played === total ? 'Complete' : `${played} of ${total} series played`,
    ]
      .filter(Boolean)
      .join(' · ')
  })

  const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')
</script>

<svelte:head><title>Leaderboard</title></svelte:head>

<PageContainer>
  <div class="page-content py-6">
    <article class="sheet">
      <header class="lb-head">
        <div class="min-w-0">
          {#if season?.name}<div class="lb-eyebrow">{season.name}</div>{/if}
          <h1 class="lb-title">Leaderboard</h1>
          {#if season}<p class="lb-meta">{metaLine}</p>{/if}
        </div>
        {#if myTeam}
          <a href={resolve(`/teams/${myTeam.id}`)} class="my-team">
            <span class="lb-label">Your team</span>
            {#if myTeam.logo_url}<img src={myTeam.logo_url} alt="" class="my-team-logo" />{/if}
            <span class="my-team-name">{myTeam.name}</span>
            {#if myRank != null}<span class="my-team-rank">{ordinal(myRank)}</span>{/if}
          </a>
        {/if}
      </header>

      {#if !season}
        <!-- Off-season: no standings, no roster, nothing to search. -->
        <div class="lb-empty sheet-section">
          <p class="lb-empty-title">No season in progress</p>
          <p>
            Standings and teams appear here once the next season starts. Past seasons are on the
            <a href={resolve('/events')}>events page</a>.
          </p>
        </div>
      {:else}
        <div class="lb-bar">
          <label class="lb-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              bind:value={search}
              placeholder="Search teams"
              aria-label="Search teams"
            />
          </label>
          {#if isAdmin && !editingZones}
            <button type="button" class="zones-btn" onclick={() => (editingZones = true)}>
              Edit zones
            </button>
          {/if}
        </div>

        {#if isAdmin && editingZones}
          <div class="sheet-section sheet-body">
            <StandingsZonesEditor
              seasonId={season.id}
              config={zones}
              teams={allRanked.map((r) => ({ id: r.id, name: r.name, rank: r.stats.rank ?? null }))}
              onClose={() => (editingZones = false)}
            />
          </div>
        {/if}

        {#if bracket}
          <section class="sheet-section" aria-labelledby="playoffs-title">
            <div class="sheet-head">
              <h2 class="sheet-title" id="playoffs-title">Playoffs</h2>
              <span class="sheet-note">{playoffNote}</span>
            </div>
            <div class="sheet-body">
              <ArchiveBracket
                slots={bracket.slots}
                teams={bracket.teams}
                {seeds}
                matchIds={bracket.matchIds}
                series={bracket.series}
                query={search}
                myTeamId={myTeam?.id ?? null}
              />
            </div>
          </section>
        {/if}

        <section class="sheet-section" aria-labelledby="standings-title">
          <div class="sheet-head">
            <h2 class="sheet-title" id="standings-title">Standings</h2>
            <span class="sheet-note">Regular season · ties broken by round differential</span>
          </div>

          {#if rows.length === 0}
            <p class="lb-empty">Approved teams and their standings will appear here.</p>
          {:else if allRanked.length === 0}
            <p class="lb-empty">No standings yet.</p>
          {:else if ranked.length === 0}
            <p class="lb-empty">No teams match “{search}”.</p>
          {:else}
            <div class="table-wrap">
              <table class="standings">
                <thead>
                  <tr>
                    <th class="col-rank">#</th>
                    <th class="col-team">Team</th>
                    <th class="col-num col-seed">Seed</th>
                    {#if season.showPoints}<th class="col-num">Pts</th>{/if}
                    <th class="col-num">Series</th>
                    <th class="col-num col-maps">Maps</th>
                    <th class="col-num" title="Round differential, used to break ties">RD</th>
                  </tr>
                </thead>
                {#each groups as group (group.zone?.id ?? 'none')}
                  <tbody
                    class:dim={group.dim}
                    style={group.zone
                      ? `--zone-color: ${ZONE_TONE_COLORS[group.zone.tone]};`
                      : undefined}
                  >
                    {#if group.zone}
                      <tr class="zone-row">
                        <td colspan="7">
                          <span class="zone-label">
                            <span class="zone-dot"></span>
                            {group.zone.label}
                            <span class="zone-range">{zoneRangeLabel(group.zone)}</span>
                          </span>
                        </td>
                      </tr>
                    {/if}
                    {#each group.rows as row (row.id)}
                      <tr class:row-mine={myTeam?.id === row.id}>
                        <!-- No rank until the season's first import. -->
                        <td class="col-rank" class:zoned={group.zone != null}>
                          {row.stats.rank ?? '—'}
                        </td>
                        <td class="col-team">
                          <a href={resolve(`/teams/${row.id}`)} class="team-cell">
                            {#if row.logo_url}
                              <img src={row.logo_url} alt="" class="team-logo" />
                            {:else}
                              <span class="team-logo team-logo-blank"></span>
                            {/if}
                            <span class="team-name">{row.name}</span>
                            {#if row.tag}
                              <span class="team-tag">{String(row.tag).toUpperCase()}</span>
                            {/if}
                            {#if row.locked}
                              <span
                                class="team-locked"
                                title="Locked in: decided regardless of rank"
                              >
                                <Lock size={10} aria-hidden="true" /> Locked
                              </span>
                            {/if}
                          </a>
                        </td>
                        <td class="col-num col-seed muted">{seeds[row.id] ?? '–'}</td>
                        {#if season.showPoints}
                          <td class="col-num col-points">{row.stats.points}</td>
                        {/if}
                        <td class="col-num" title="{row.stats.series_played} played">
                          {row.stats.series_wins}–{row.stats.series_losses}
                        </td>
                        <td class="col-num col-maps" title="{row.stats.maps_played} played">
                          {row.stats.map_wins}–{row.stats.map_losses}
                        </td>
                        <td
                          class="col-num"
                          class:rd-pos={row.stats.round_diff > 0}
                          class:rd-neg={row.stats.round_diff < 0}
                        >
                          {signed(row.stats.round_diff)}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                {/each}
              </table>
            </div>
          {/if}
        </section>
      {/if}
    </article>
  </div>
</PageContainer>

<style src="./page.css"></style>
