<script lang="ts">
  import { goto } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { untrack } from 'svelte'
  import { X } from 'lucide-svelte'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import BatchPicker from '$lib/components/stats/BatchPicker.svelte'
  import CompareAddSlot from '$lib/components/CompareAddSlot.svelte'
  import { MAX_COMPARE, type CompareKind } from '$lib/compare'
  import { compareTray } from '$lib/stores/search.svelte'
  import type {
    Meeting,
    PlayerPair,
    Record2,
    RowAggregate,
    TeamPair,
    TeamSummary,
  } from '$lib/server/compare/compute'
  import type { CompareEntity, StatsRow } from './+page.server'
  import type { Finish, PlayerHonors } from '$lib/server/compare/honors'
  import { ordinal } from '$lib/format/ordinal'

  let { data } = $props()

  const kind = $derived(data.kind as CompareKind)
  const entities = $derived(data.entities as CompareEntity[])
  const ready = $derived(entities.length >= 2)
  /** Room for one more: the table shows an empty "+" column. */
  const canAdd = $derived(entities.length < MAX_COMPARE)

  // Keep the search tray in step with what this page shows, so "Add" from
  // search extends this comparison instead of starting over.
  $effect(() => {
    const kindNow = kind
    const items = entities.map((e) => ({
      id: e.id,
      name: e.name,
      subtitle: e.subtitle,
      imageUrl: e.imageUrl,
    }))
    // Writing the tray must not subscribe this effect to it, or it loops.
    untrack(() => compareTray.set(kindNow, items))
  })

  // Image URLs that failed to load (a stale Discord avatar, say); they fall back to initials.
  let brokenImages = $state<Record<string, true>>({})

  /**
   * Mark an image broken when it fails, including one that already failed
   * during the server render, before hydration could attach `onerror`.
   */
  function fallbackOnError(node: HTMLImageElement, url: string) {
    const mark = () => (brokenImages[url] = true)
    if (node.complete && node.naturalWidth === 0) mark()
    node.addEventListener('error', mark)
    return { destroy: () => node.removeEventListener('error', mark) }
  }

  /** /compare with these ids (and the current stats table), as an href. */
  function hrefFor(ids: string[], batchId: string | null = data.players?.batchId ?? null): string {
    const query: Record<string, string> = { type: kind, ids: ids.join(',') }
    if (kind === 'players' && batchId) query.batchId = batchId
    return `${resolve('/compare')}?${new URLSearchParams(query).toString()}`
  }

  function entityHref(id: string): string {
    return kind === 'teams' ? resolve('/teams/[id]', { id }) : resolve('/players/[id]', { id })
  }

  /* eslint-disable svelte/no-navigation-without-resolve -- hrefFor builds on resolve() */
  function pickBatch(batchId: string) {
    goto(
      hrefFor(
        entities.map((e) => e.id),
        batchId
      ),
      { noScroll: true, keepFocus: true }
    )
  }
  /* eslint-enable svelte/no-navigation-without-resolve */

  function initials(name: string): string {
    return name.trim().slice(0, 2).toUpperCase()
  }

  // ── Formatting ───────────────────────────────────────────────────────────
  function fmt(value: number | null | undefined, digits = 0): string {
    return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits)
  }
  function pct(won: number, lost: number): number | null {
    return won + lost > 0 ? (won / (won + lost)) * 100 : null
  }
  function record(r: Record2): string {
    return `${r.won}–${r.lost}`
  }
  function date(value: string | null): string {
    if (!value) return ''
    return new Date(value).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  // ── Stat table rows ─────────────────────────────────────────────────────
  type StatLine = {
    label: string
    /** The number compared for "best"; null leaves the cell out of the contest. */
    value: (id: string) => number | null
    /** What the cell shows; defaults to `value` formatted. */
    display?: (id: string) => string
    digits?: number
    suffix?: string
    better?: 'high' | 'low'
  }

  const teamSummaries = $derived(
    new Map(((data.teams?.summaries ?? []) as TeamSummary[]).map((s) => [s.teamId, s]))
  )
  const playerStats = $derived((data.players?.stats ?? {}) as Record<string, StatsRow | null>)

  function teamStat(id: string, key: keyof RowAggregate): number | null {
    const v = teamSummaries.get(id)?.stats?.[key]
    return typeof v === 'number' ? v : null
  }
  function playerStat(id: string, key: keyof StatsRow): number | null {
    const v = playerStats[id]?.[key]
    return typeof v === 'number' ? v : null
  }

  const teamLines: StatLine[] = [
    {
      label: 'Series',
      value: (id) => {
        const s = teamSummaries.get(id)
        return s ? pct(s.series.won, s.series.lost) : null
      },
      display: (id) => {
        const s = teamSummaries.get(id)
        if (!s) return '—'
        const p = pct(s.series.won, s.series.lost)
        return `${record(s.series)}${p == null ? '' : ` (${p.toFixed(0)}%)`}`
      },
      better: 'high',
    },
    {
      label: 'Maps',
      value: (id) => {
        const s = teamSummaries.get(id)
        return s ? pct(s.maps.won, s.maps.lost) : null
      },
      display: (id) => {
        const s = teamSummaries.get(id)
        if (!s) return '—'
        const p = pct(s.maps.won, s.maps.lost)
        return `${record(s.maps)}${p == null ? '' : ` (${p.toFixed(0)}%)`}`
      },
      better: 'high',
    },
    {
      label: 'Round diff',
      value: (id) => {
        const s = teamSummaries.get(id)
        return s && s.roundsWon + s.roundsLost > 0 ? s.roundsWon - s.roundsLost : null
      },
      display: (id) => {
        const s = teamSummaries.get(id)
        if (!s || s.roundsWon + s.roundsLost === 0) return '—'
        const d = s.roundsWon - s.roundsLost
        return d > 0 ? `+${d}` : String(d)
      },
      better: 'high',
    },
    { label: 'Team ACS', value: (id) => teamStat(id, 'acs'), better: 'high' },
    { label: 'K/D', value: (id) => teamStat(id, 'kd'), digits: 2, better: 'high' },
    { label: 'KAST', value: (id) => teamStat(id, 'kast_pct'), suffix: '%', better: 'high' },
    { label: 'ADR', value: (id) => teamStat(id, 'adr'), better: 'high' },
    { label: 'HS%', value: (id) => teamStat(id, 'hs_pct'), suffix: '%', better: 'high' },
    {
      label: 'First kills – deaths',
      value: (id) => {
        const s = teamSummaries.get(id)?.stats
        return s ? s.fk - s.fd : null
      },
      display: (id) => {
        const s = teamSummaries.get(id)?.stats
        return s ? `${s.fk}–${s.fd}` : '—'
      },
      better: 'high',
    },
  ]

  /** Attempts needed before a clutch win rate competes for "best". */
  const MIN_CLUTCH_ATTEMPTS = 5

  const playerLines: StatLine[] = [
    { label: 'Maps', value: (id) => playerStat(id, 'games') },
    {
      label: 'Win %',
      value: (id) => {
        const won = playerStat(id, 'games_won')
        const games = playerStat(id, 'games')
        return won != null && games ? (won / games) * 100 : null
      },
      suffix: '%',
      better: 'high',
    },
    { label: 'ACS', value: (id) => playerStat(id, 'acs'), better: 'high' },
    { label: 'K/D', value: (id) => playerStat(id, 'kd'), digits: 2, better: 'high' },
    { label: 'KAST', value: (id) => playerStat(id, 'kast_pct'), suffix: '%', better: 'high' },
    { label: 'ADR', value: (id) => playerStat(id, 'adr'), better: 'high' },
    { label: 'HS%', value: (id) => playerStat(id, 'hs_pct'), suffix: '%', better: 'high' },
    { label: 'Kills / round', value: (id) => playerStat(id, 'kpr'), digits: 2, better: 'high' },
    { label: 'Assists / round', value: (id) => playerStat(id, 'apr'), digits: 2, better: 'high' },
    {
      label: 'First kills / map',
      value: (id) => playerStat(id, 'fkpg'),
      digits: 2,
      better: 'high',
    },
    {
      label: 'First deaths / map',
      value: (id) => playerStat(id, 'fdpg'),
      digits: 2,
      better: 'low',
    },
    { label: 'Clutches won', value: (id) => playerStat(id, 'clutches_won'), better: 'high' },
    {
      label: 'Clutch %',
      // Too few attempts and one lucky 1v1 tops the row, so they show but don't compete.
      value: (id) => {
        const won = playerStat(id, 'clutches_won')
        const tried = playerStat(id, 'clutches_attempted')
        return won != null && tried != null && tried >= MIN_CLUTCH_ATTEMPTS
          ? (won / tried) * 100
          : null
      },
      display: (id) => {
        const won = playerStat(id, 'clutches_won')
        const tried = playerStat(id, 'clutches_attempted')
        if (won == null || !tried) return '—'
        return `${((won / tried) * 100).toFixed(0)}% (${won}/${tried})`
      },
      better: 'high',
    },
  ]

  // A stat no one has a value for (clutches in a table imported without them) is just noise.
  // ── Placement, titles and MVPs (bottom of the table) ────────────────────────
  const playerHonors = $derived((data.players?.honors ?? {}) as Record<string, PlayerHonors>)
  const multiSeason = $derived(data.players?.multiSeason ?? true)
  const teamFinishes = $derived(
    ((data.teams as { finishes?: Record<string, Finish | null> } | null)?.finishes ?? {}) as Record<
      string,
      Finish | null
    >
  )

  function finishText(f: Finish | null | undefined): string {
    if (!f) return '—'
    const place = f.start === f.end ? ordinal(f.start) : `${ordinal(f.start)}–${ordinal(f.end)}`
    return `${place} of ${f.of}`
  }
  function finishValue(f: Finish | null | undefined): number | null {
    return f ? (f.start + f.end) / 2 : null
  }

  const honorLines = $derived.by<StatLine[]>(() => {
    if (kind === 'teams') {
      return [
        {
          label: 'Finish',
          value: (id) => finishValue(teamFinishes[id]),
          display: (id) => finishText(teamFinishes[id]),
          better: 'low',
        },
      ]
    }
    if (!multiSeason) {
      return [
        {
          label: 'Finish',
          value: (id) => finishValue(playerHonors[id]?.finish),
          display: (id) => finishText(playerHonors[id]?.finish),
          better: 'low',
        },
        {
          label: 'MVP',
          value: (id) => playerHonors[id]?.mvps ?? null,
          display: (id) => (playerHonors[id]?.mvps ? 'MVP' : '—'),
          better: 'high',
        },
      ]
    }
    return [
      {
        label: 'Avg finish',
        value: (id) => playerHonors[id]?.avgFinish ?? null,
        display: (id) => {
          const h = playerHonors[id]
          if (h?.avgFinish == null) return '—'
          return `${h.avgFinish.toFixed(1)} (best ${ordinal(h.bestFinish ?? 0)})`
        },
        better: 'low',
      },
      {
        label: 'Championships',
        value: (id) => playerHonors[id]?.championships ?? null,
        better: 'high',
      },
      { label: 'MVPs', value: (id) => playerHonors[id]?.mvps ?? null, better: 'high' },
    ]
  })

  const lines = $derived(
    [...(kind === 'teams' ? teamLines : playerLines), ...honorLines].filter((line) =>
      entities.some((e) => cellText(line, e.id) !== '—')
    )
  )

  /** The ids holding the best value on a line, or none when it is not a contest. */
  function bestOf(line: StatLine): Set<string> {
    if (!line.better) return new Set()
    const values = entities
      .map((e) => ({ id: e.id, v: line.value(e.id) }))
      .filter((x): x is { id: string; v: number } => x.v != null && Number.isFinite(x.v))
    if (values.length < 2) return new Set()
    const target =
      line.better === 'high'
        ? Math.max(...values.map((x) => x.v))
        : Math.min(...values.map((x) => x.v))
    if (values.every((x) => x.v === target)) return new Set()
    return new Set(values.filter((x) => x.v === target).map((x) => x.id))
  }

  function cellText(line: StatLine, id: string): string {
    if (line.display) return line.display(id)
    const v = line.value(id)
    return v == null ? '—' : `${fmt(v, line.digits ?? 0)}${line.suffix ?? ''}`
  }

  // ── Head to head ───────────────────────────────────────────────────────
  const entityById = $derived(new Map(entities.map((e) => [e.id, e])))

  type OrientedPair = {
    series: Record2
    maps: Record2
    together: (Record2 & { maps: number }) | null
    statsMine: RowAggregate | null
    statsTheirs: RowAggregate | null
    meetings: Meeting[]
  }

  function flip(r: Record2): Record2 {
    return { won: r.lost, lost: r.won }
  }

  function flipMeeting(m: Meeting): Meeting {
    return { ...m, scoreA: m.scoreB, scoreB: m.scoreA, teamA: m.teamB, teamB: m.teamA }
  }

  /** The pair between x and y, seen from x's side. */
  function pairFor(x: string, y: string): OrientedPair | null {
    if (kind === 'teams') {
      const pairs = (data.teams?.pairs ?? []) as TeamPair[]
      const p = pairs.find((q) => (q.a === x && q.b === y) || (q.a === y && q.b === x))
      if (!p) return null
      const mine = p.a === x
      return {
        series: mine ? p.series : flip(p.series),
        maps: mine ? p.maps : flip(p.maps),
        together: null,
        statsMine: null,
        statsTheirs: null,
        meetings: mine ? p.meetings : p.meetings.map(flipMeeting),
      }
    }
    const pairs = (data.players?.pairs ?? []) as PlayerPair[]
    const p = pairs.find((q) => (q.a === x && q.b === y) || (q.a === y && q.b === x))
    if (!p) return null
    const mine = p.a === x
    return {
      series: mine ? p.againstSeries : flip(p.againstSeries),
      maps: mine ? p.against : flip(p.against),
      together: p.together,
      statsMine: mine ? p.statsA : p.statsB,
      statsTheirs: mine ? p.statsB : p.statsA,
      meetings: mine ? p.meetings : p.meetings.map(flipMeeting),
    }
  }

  function hasMet(p: OrientedPair | null): boolean {
    return !!p && (p.meetings.length > 0 || p.series.won + p.series.lost > 0)
  }

  function lead(p: OrientedPair | null): 'good' | 'bad' | null {
    if (!p) return null
    const s = p.series.won - p.series.lost
    const m = p.maps.won - p.maps.lost
    const v = s !== 0 ? s : m
    return v > 0 ? 'good' : v < 0 ? 'bad' : null
  }

  function teamName(id: string | null): string {
    if (!id) return '?'
    if (kind === 'teams') return entityById.get(id)?.name ?? '?'
    return (data.players?.teamNames as Record<string, string> | undefined)?.[id] ?? '?'
  }

  /** Pairs worth listing below the grid: those who met or were teammates. */
  const pairList = $derived(
    entities
      .flatMap((x, i) => entities.slice(i + 1).map((y) => ({ x, y, pair: pairFor(x.id, y.id) })))
      .filter(({ pair }) => hasMet(pair) || (pair?.together?.maps ?? 0) > 0)
  )

  /** Series judged from rosters (no map stats) across every pair, for the card's note. */
  const rosterSeries = $derived(
    ((data.players?.pairs ?? []) as PlayerPair[]).reduce((n, p) => n + (p.fromRosters ?? 0), 0)
  )

  const twoUp = $derived(entities.length === 2)
  const solo = $derived(twoUp ? pairFor(entities[0]!.id, entities[1]!.id) : null)

  const pageTitle = $derived(
    ready
      ? entities.map((e) => e.name).join(' vs ')
      : kind === 'teams'
        ? 'Compare teams'
        : 'Compare players'
  )
</script>

<svelte:head><title>{pageTitle}</title></svelte:head>

{#snippet thumb(entity: CompareEntity, size: 'sm' | 'lg')}
  {#if entity.imageUrl && !brokenImages[entity.imageUrl]}
    <img
      class="thumb thumb-{size}"
      class:thumb-round={kind === 'players'}
      src={entity.imageUrl}
      alt=""
      use:fallbackOnError={entity.imageUrl}
    />
  {:else}
    <span class="thumb thumb-{size} thumb-blank" class:thumb-round={kind === 'players'}
      >{initials(entity.tag || entity.name)}</span
    >
  {/if}
{/snippet}

<!-- A name that links to the player/team, with an × that shows on hover (always on touch screens). -->
{#snippet removable(entity: CompareEntity)}
  <span class="ent">
    <!-- eslint-disable svelte/no-navigation-without-resolve -- entityHref and hrefFor build on resolve() -->
    <a class="ent-link" href={entityHref(entity.id)} title={entity.subtitle ?? undefined}>
      {@render thumb(entity, 'sm')}
      <span class="ent-name">{entity.name}</span>
    </a>
    <a
      class="ent-x"
      href={hrefFor(entities.filter((e) => e.id !== entity.id).map((e) => e.id))}
      data-sveltekit-noscroll
      title="Remove from comparison"
      aria-label={`Remove ${entity.name}`}><X class="h-3 w-3" /></a
    >
    <!-- eslint-enable svelte/no-navigation-without-resolve -->
  </span>
{/snippet}

{#snippet addSlot()}
  <CompareAddSlot
    {kind}
    excludeIds={entities.map((e) => e.id)}
    hrefWith={(id) => hrefFor([...entities.map((e) => e.id), id])}
  />
{/snippet}

{#snippet meetingList(x: CompareEntity, meetings: Meeting[])}
  <ul class="meetings">
    {#each meetings as m (m.matchId)}
      <li>
        <a href={resolve('/matches/[id]', { id: m.matchId })} class="meeting">
          <span class="meeting-date">{date(m.scheduledAt)}</span>
          <span
            class="meeting-teams"
            title={kind === 'players' ? `${x.name}'s team first` : undefined}
            >{teamName(m.teamA)} vs {teamName(m.teamB)}</span
          >
          <span
            class="meeting-score"
            class:score-good={m.scoreA > m.scoreB}
            class:score-bad={m.scoreA < m.scoreB}>{m.scoreA}–{m.scoreB}</span
          >
        </a>
      </li>
    {/each}
  </ul>
{/snippet}

<PageContainer>
  <!-- As wide as the cards, so the title sits above the first card's left edge. -->
  <div class="compare-page">
    <header class="compare-head">
      <h1 class="compare-title">{kind === 'teams' ? 'Compare teams' : 'Compare players'}</h1>
      <p class="compare-sub">
        {ready
          ? `${entities.length} ${kind} side by side`
          : `Pick up to ${MAX_COMPARE} ${kind} to compare`}
      </p>
    </header>

    <div class="compare">
      {#if !ready}
        <section class="card empty">
          {#if entities.length > 0}
            <div class="empty-picked empty-picked-list">
              {#each entities as entity (entity.id)}
                {@render removable(entity)}
              {/each}
            </div>
          {/if}
          <div class="empty-picked">{@render addSlot()}</div>
          <p>
            Use <strong>+</strong> above to add {kind === 'teams' ? 'teams' : 'players'} (up to
            {MAX_COMPARE}), or press <strong>+</strong> next to results in search (<kbd>Ctrl K</kbd
            >).
          </p>
        </section>
      {:else}
        <!-- Side-by-side stats -->
        <section class="card">
          <header class="card-head">
            <h2 class="card-title">Stats</h2>
            {#if kind === 'teams'}
              <span class="card-note">Recorded matches for each team's season.</span>
            {/if}
          </header>
          {#if kind === 'players' && data.players}
            <div class="picker-row">
              <BatchPicker
                batches={data.players.batches}
                events={data.players.events}
                batchId={data.players.batchId}
                onPick={pickBatch}
              />
            </div>
          {/if}
          <div class="table-scroll">
            <table class="data-table compare-table">
              <thead>
                <tr>
                  <th class="col-stat"></th>
                  {#each entities as entity (entity.id)}
                    <th class="col-entity">{@render removable(entity)}</th>
                  {/each}
                  {#if canAdd}
                    <th class="col-entity col-add">{@render addSlot()}</th>
                  {/if}
                </tr>
              </thead>
              <tbody>
                {#each lines as line (line.label)}
                  {@const best = bestOf(line)}
                  <tr>
                    <th scope="row" class="col-stat">{line.label}</th>
                    {#each entities as entity (entity.id)}
                      <td class="num" class:best={best.has(entity.id)}
                        >{cellText(line, entity.id)}</td
                      >
                    {/each}
                    {#if canAdd}<td class="col-add"></td>{/if}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if kind === 'players' && entities.some((e) => !playerStats[e.id])}
            <p class="card-foot">
              “—” means the player has no row in this stats table. Try another season above.
            </p>
          {/if}
        </section>

        <!-- Map pool: same column-per-team shape as Stats, so it sits beside it. -->
        {#if kind === 'teams'}
          <section class="card">
            <header class="card-head"><h2 class="card-title">Map pool</h2></header>
            <div class="pools" style="--cols: {entities.length}">
              {#each entities as entity (entity.id)}
                {@const pool = teamSummaries.get(entity.id)?.mapPool ?? []}
                <div class="pool">
                  <div class="pool-head">
                    {@render thumb(entity, 'sm')}<span>{entity.name}</span>
                  </div>
                  {#if pool.length === 0}
                    <p class="muted">No maps recorded.</p>
                  {:else}
                    <ul>
                      {#each pool as entry (entry.map)}
                        <li>
                          <span>{entry.map}</span>
                          <span
                            class="pool-rec"
                            class:score-good={entry.won * 2 > entry.played}
                            class:score-bad={entry.won * 2 < entry.played}
                            >{entry.won}–{entry.played - entry.won}</span
                          >
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/each}
            </div>
          </section>
          <!-- Force Head to head (square grid) onto its own row below. -->
          <div class="row-break" aria-hidden="true"></div>
        {/if}

        <!-- Head to head -->
        <section class="card">
          <header class="card-head">
            <h2 class="card-title">Head to head</h2>
            <span class="card-note">
              {kind === 'players'
                ? (data.players?.scopeLabel ?? 'All Rivals seasons')
                : 'Series between these teams.'}
            </span>
            {#if rosterSeries > 0}
              <span
                class="card-note roster-note"
                title="These matches have no per-map stats, so each player's side comes from their team's roster at the time, and the series score stands in for maps."
                >Includes {rosterSeries} series from team rosters</span
              >
            {/if}
          </header>

          {#if twoUp}
            {@const a = entities[0]!}
            {@const b = entities[1]!}
            {#if !hasMet(solo) && !(solo?.together?.maps ?? 0)}
              <p class="empty-inline">
                {a.name} and {b.name} have no recorded {kind === 'players' ? 'maps' : 'series'} together.
              </p>
            {:else}
              <div class="duel">
                {#if hasMet(solo)}
                  <div class="duel-score">
                    <span class="duel-side">{@render thumb(a, 'lg')}<span>{a.name}</span></span>
                    <span class="duel-num">
                      <span class:score-good={solo!.series.won > solo!.series.lost}
                        >{solo!.series.won}</span
                      >
                      <span class="duel-dash">–</span>
                      <span class:score-good={solo!.series.lost > solo!.series.won}
                        >{solo!.series.lost}</span
                      >
                      <span class="duel-caption">series</span>
                    </span>
                    <span class="duel-side">{@render thumb(b, 'lg')}<span>{b.name}</span></span>
                  </div>
                  <dl class="duel-facts">
                    <div>
                      <dt>{kind === 'players' ? 'Maps against' : 'Maps'}</dt>
                      <dd>{record(solo!.maps)}</dd>
                    </div>
                    {#if kind === 'players' && solo!.statsMine && solo!.statsTheirs}
                      <div>
                        <dt>ACS when facing</dt>
                        <dd>{fmt(solo!.statsMine.acs)} vs {fmt(solo!.statsTheirs.acs)}</dd>
                      </div>
                      <div>
                        <dt>K/D when facing</dt>
                        <dd>{fmt(solo!.statsMine.kd, 2)} vs {fmt(solo!.statsTheirs.kd, 2)}</dd>
                      </div>
                    {/if}
                    {#if solo?.together?.maps}
                      <div>
                        <dt>Maps together</dt>
                        <dd>{record(solo.together)}</dd>
                      </div>
                    {/if}
                  </dl>
                {:else if solo?.together?.maps}
                  <p class="empty-inline">
                    Never on opposite sides, but teammates for {solo.together.maps} maps ({record(
                      solo.together
                    )}).
                  </p>
                {/if}
                {#if solo && solo.meetings.length > 0}
                  {@render meetingList(a, solo.meetings)}
                {/if}
              </div>
            {/if}
          {:else}
            <div class="table-scroll">
              <table class="data-table h2h-grid">
                <thead>
                  <tr>
                    <th class="col-stat"><span class="sr-only">Row vs column</span></th>
                    {#each entities as entity (entity.id)}
                      <!-- Compact column heads (tag, or a clipped name); the rows carry full names. -->
                      <th class="col-entity col-compact" title={entity.name}>
                        <span class="col-entity-inner">
                          {@render thumb(entity, 'sm')}
                          <span class="col-entity-name">{entity.tag || entity.name}</span>
                        </span>
                      </th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each entities as row (row.id)}
                    <tr>
                      <th scope="row" class="col-stat">
                        <span class="col-entity-inner">
                          {@render thumb(row, 'sm')}
                          <span class="col-entity-name">{row.name}</span>
                        </span>
                      </th>
                      {#each entities as col (col.id)}
                        {@const p = row.id === col.id ? null : pairFor(row.id, col.id)}
                        <td
                          class="h2h-cell"
                          class:self={row.id === col.id}
                          class:cell-good={lead(p) === 'good'}
                          class:cell-bad={lead(p) === 'bad'}
                        >
                          {#if row.id !== col.id}
                            {#if hasMet(p)}
                              <span
                                class="h2h-main"
                                title={`${row.name}'s series record against ${col.name}`}
                                >{record(p!.series)}<span class="h2h-unit">series</span></span
                              >
                              <span
                                class="h2h-sub"
                                title={kind === 'players'
                                  ? `Maps won–lost on opposite teams`
                                  : `Maps won–lost against ${col.name}`}
                                ><span class="h2h-label"
                                  >{kind === 'players' ? 'Against' : 'Maps'}</span
                                >
                                {record(p!.maps)}</span
                              >
                            {:else if !p?.together?.maps}
                              <span class="muted">—</span>
                            {/if}
                            {#if p?.together?.maps}
                              <span class="h2h-sub h2h-mates" title="Maps won–lost as teammates"
                                ><span class="h2h-label">Together</span>
                                {record(p.together)}</span
                              >
                            {/if}
                          {/if}
                        </td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>

            {#if pairList.length > 0}
              <div class="pair-list">
                {#each pairList as { x, y, pair } (x.id + y.id)}
                  {#if pair && pair.meetings.length > 0}
                    <details class="pair">
                      <summary>
                        <span class="pair-names"
                          >{x.name} <span class="muted">vs</span> {y.name}</span
                        >
                        <span class="pair-rec">{record(pair.series)}</span>
                        <span class="muted"
                          >· {pair.meetings.length}
                          {pair.meetings.length === 1 ? 'match' : 'matches'}</span
                        >
                      </summary>
                      {@render meetingList(x, pair.meetings)}
                    </details>
                  {/if}
                {/each}
              </div>
            {/if}
          {/if}
        </section>
      {/if}
    </div>
  </div>
</PageContainer>

<style src="./page.css"></style>
