<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import ClipPlayer from '$lib/components/ClipPlayer.svelte'
  import { resolve } from '$app/paths'
  import ExternalEventsToggle from '$lib/components/ExternalEventsToggle.svelte'
  import { externalEvents } from '$lib/stores/external-events.svelte'

  let { data }: PageProps = $props()

  const records = $derived(data.records ?? [])
  const moments = $derived(data.moments ?? [])
  const awards = $derived(data.awards ?? [])
  const seasonChampions = $derived(data.seasonChampions ?? [])
  const statRecords = $derived(data.statRecords ?? [])
  const recordTrack = $derived(data.recordTrack)
  const allTrackOptions = $derived(data.trackOptions ?? [])
  // A side league's tab is hidden unless external events are shown — never the
  // default book or the one being viewed.
  const isHideable = (o: (typeof allTrackOptions)[number]) =>
    o.isSideLeague && !o.isDefault && o.key !== data.recordTrack.key
  const hasHideableTracks = $derived(allTrackOptions.some(isHideable))
  const trackOptions = $derived(
    externalEvents.show ? allTrackOptions : allTrackOptions.filter((o) => !isHideable(o))
  )

  type StatRecord = PageProps['data']['statRecords'][number]
  type StatEntry = StatRecord['top'][number]
  type Holderish = {
    holderKind: 'player' | 'team'
    holder: { id: string | null; name: string } | null
    team: { id: string; name: string; tag: string | null } | null
    opponent: { id: string; name: string; tag: string | null } | null
    context: Record<string, unknown>
  }

  // Fixed zone so the server render and the browser agree; the league plays on NA time.
  const LEAGUE_TZ = 'America/New_York'

  function formatDate(iso: string | null, withYear = true) {
    if (!iso) return null
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone: LEAGUE_TZ,
    })
  }

  function formatMonth(iso: string | null) {
    if (!iso) return null
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
  }

  /** Admin-typed season names sometimes carry stray spaces ("Season  2"). */
  function cleanName(name: string) {
    return name.replace(/\s+/g, ' ').trim()
  }

  /**
   * A team record is a map two teams played, so both are named — winner first.
   * The short form (tags) fits the narrow podium rows.
   */
  function holderName(step: Holderish, short = false) {
    if (step.holderKind === 'player') {
      const name = step.holder?.name ?? 'Player'
      // A duel is between two players, so the one they beat is named too.
      const rival = step.context.duel_opponent_name
      return typeof rival === 'string' ? `${name} vs ${rival}` : name
    }
    const name = (t: { name: string; tag: string | null }) => (short ? (t.tag ?? t.name) : t.name)
    const team = step.team ? name(step.team) : 'Team'
    return step.opponent ? `${team} vs ${name(step.opponent)}` : team
  }

  /** "ELO vs SS · Iso" under a player record holder. */
  function holderContext(entry: StatEntry) {
    if (entry.holderKind !== 'player') return null
    const parts: string[] = []
    const tag = (t: { name: string; tag: string | null } | null) => (t ? (t.tag ?? t.name) : null)
    const team = tag(entry.team)
    const opp = tag(entry.opponent)
    if (team && opp) parts.push(`${team} vs ${opp}`)
    else if (team) parts.push(team)
    if (entry.agents) parts.push(entry.agents)
    return parts.join(' · ') || null
  }

  function num(context: Record<string, unknown>, key: string) {
    const v = context[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }

  /** The game behind the number: K/D/A, ACS and how the map ended. */
  function statLine(entry: StatEntry) {
    const c = entry.context
    const won = num(c, 'rounds_won')
    const lost = num(c, 'rounds_lost')
    const overtime = won !== null && lost !== null && won + lost > 24
    if (entry.holderKind === 'team') {
      if (won === null || lost === null) return null
      return `Won ${won}–${lost}${overtime ? ' after overtime' : ''}`
    }
    const parts: string[] = []
    const duelFor = num(c, 'duel_kills_for')
    const duelAgainst = num(c, 'duel_kills_against')
    if (duelFor !== null && duelAgainst !== null)
      parts.push(`Won the duel ${duelFor}–${duelAgainst}`)
    const k = num(c, 'kills')
    const d = num(c, 'deaths')
    const a = num(c, 'assists')
    if (k !== null && d !== null && a !== null) parts.push(`${k} / ${d} / ${a}`)
    const acs = num(c, 'acs')
    if (acs !== null && duelFor === null) parts.push(`${Math.round(acs)} ACS`)
    if (won !== null && lost !== null) {
      parts.push(`${won > lost ? 'won' : 'lost'} ${won}–${lost}${overtime ? ' in OT' : ''}`)
    }
    return parts.join(' · ') || null
  }

  /** "Sunset · Aug 31" — the record's match link text. */
  function whereText(entry: StatEntry) {
    const date = formatDate(entry.achievedAt, false)
    return [entry.mapName, date].filter(Boolean).join(' · ') || 'Match'
  }

  /** Bar length against the record holder, so the gap to the chasers shows. */
  function barWidth(entry: StatEntry, leader: StatEntry) {
    const top = Math.abs(leader.rawValue)
    if (!top) return 100
    return Math.max(4, Math.min(100, Math.round((Math.abs(entry.rawValue) / top) * 100)))
  }

  const isEmpty = $derived(
    statRecords.length === 0 &&
      records.length === 0 &&
      moments.length === 0 &&
      awards.length === 0 &&
      seasonChampions.length === 0
  )
</script>

<svelte:head><title>Hall of Fame</title></svelte:head>

{#snippet statRecordTile(record: StatRecord)}
  {@const leader = record.top[0]}
  {@const line = statLine(leader)}
  {@const context = holderContext(leader)}
  <article class="rec">
    <div class="rec-top">
      <span class="rec-label">{record.title}</span>
      <a href={resolve(`/matches/${leader.matchId}`)} class="rec-match">{whereText(leader)} →</a>
    </div>
    <div class="rec-value">
      {leader.value}<span class="rec-unit">{leader.unit}</span>
    </div>
    <div class="rec-who">
      <span class="rec-name">{holderName(leader)}</span>
      {#if context}<span class="rec-ctx">{context}</span>{/if}
    </div>
    {#if line}<div class="rec-line">{line}</div>{/if}
    {#if record.description}<p class="rec-desc">{record.description}</p>{/if}
    <ol class="podium">
      {#each record.top as entry (entry.entryKey)}
        <li>
          <a
            href={resolve(`/matches/${entry.matchId}`)}
            class="pod-row"
            class:rank-gold={entry.rank === 1}
            class:rank-silver={entry.rank === 2}
            class:rank-bronze={entry.rank === 3}
          >
            <span class="pod-rank">{entry.rank}</span>
            <span class="pod-who">{holderName(entry, true)}</span>
            <span class="pod-value">{entry.value}</span>
            <span class="pod-bar"><span style:width="{barWidth(entry, leader)}%"></span></span>
          </a>
        </li>
      {/each}
    </ol>
    {#if record.hiddenTies > 0}
      <p
        class="rec-ties"
        class:rec-ties-you={record.viewerTiedOff}
        title="Performances level with the last one listed that didn't fit"
      >
        {#if record.viewerTiedOff && record.hiddenTies === 1}
          You're also tied at {record.top.at(-1)?.value}
        {:else if record.viewerTiedOff}
          You and {record.hiddenTies - 1} more tied at {record.top.at(-1)?.value}
        {:else}
          +{record.hiddenTies} more tied at {record.top.at(-1)?.value}
        {/if}
      </p>
    {/if}
  </article>
{/snippet}

<PageContainer>
  <div class="page-content py-6">
    <PageHeading
      title="Hall of Fame"
      subtitle={recordTrack.isSideLeague
        ? `${recordTrack.label}: its champions, records and moments.`
        : 'Records, champions, and the moments worth remembering.'}
    >
      {#snippet actions()}
        <div class="hof-actions">
          {#if trackOptions.length > 1}
            <!-- Rivals is permanent; side leagues keep their own book, frozen once they end. -->
            <nav class="track-seg" aria-label="Event">
              {#each trackOptions as option (option.key)}
                <!-- eslint-disable svelte/no-navigation-without-resolve -->
                <!-- resolve() plus a ?track= query; the rule cannot see through the concatenation -->
                <a
                  href={resolve('/hall-of-fame') +
                    (option.isDefault ? '' : `?track=${encodeURIComponent(option.key)}`)}
                  class="track-option"
                  class:active={option.key === recordTrack.key}
                  aria-current={option.key === recordTrack.key ? 'page' : undefined}
                  data-sveltekit-noscroll
                >
                  {option.label}{option.isPast ? ' (archived)' : ''}
                </a>
                <!-- eslint-enable svelte/no-navigation-without-resolve -->
              {/each}
            </nav>
          {/if}
          {#if hasHideableTracks}
            <ExternalEventsToggle label="External events" />
          {/if}
        </div>
      {/snippet}
    </PageHeading>

    {#if isEmpty && recordTrack.isSideLeague}
      <div class="sheet">
        <div class="empty-state">
          <p class="empty-title">Nothing enshrined for {recordTrack.label} yet</p>
        </div>
      </div>
    {:else if isEmpty}
      <div class="sheet">
        <div class="empty-state">
          <p class="empty-title">Nothing enshrined yet</p>
          <p class="empty-text">
            Season champions appear here automatically once a winner is set on a season. Stat
            records are tracked from Season 5 on and fill in as matches are imported. Moments are
            added from the admin panel.
          </p>
        </div>
      </div>
    {:else}
      <div class="sheet hof-sheet">
        <!-- Champions -->
        {#if seasonChampions.length > 0}
          <section class="sheet-section" aria-labelledby="hof-champions">
            <div class="sheet-head">
              <h2 class="sheet-title" id="hof-champions">
                {recordTrack.isSideLeague ? 'Champions' : 'Season champions'}
              </h2>
              <span class="sheet-note head-aside">
                {seasonChampions.length}
                {seasonChampions.length === 1 ? 'season' : 'seasons'}
              </span>
            </div>
            <div class="sheet-body">
              <div class="champions">
                {#each seasonChampions as champ (champ.code)}
                  <div class="champ">
                    <div class="champ-season">
                      <a href={resolve(`/events/${champ.code}`)}>{cleanName(champ.name)}</a>
                      {#if champ.ends_on}<span>Ended {formatMonth(champ.ends_on)}</span>{/if}
                    </div>
                    {#if champ.winner}
                      <a href={resolve(`/teams/${champ.winner.id}`)} class="champ-team">
                        {#if champ.winner.logo_url}
                          <img src={champ.winner.logo_url} alt="" class="champ-logo" />
                        {:else}
                          <span class="champ-logo champ-logo-blank"></span>
                        {/if}
                        <span class="champ-name">{champ.winner.name}</span>
                      </a>
                    {/if}
                    {#if champ.mvp}
                      <div class="champ-mvp">
                        <span class="champ-mvp-label">MVP</span>
                        {#if champ.mvp.id}
                          <a href={resolve(`/players/${champ.mvp.id}`)}>{champ.mvp.name}</a>
                        {:else}
                          <span>{champ.mvp.name}</span>
                        {/if}
                      </div>
                    {/if}
                    {#if champ.clipUrl}
                      <div class="champ-clip">
                        <ClipPlayer
                          url={champ.clipUrl}
                          title={`${cleanName(champ.name)} winning moment`}
                        />
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          </section>
        {/if}

        <!-- Stat records (generated from match stats, Season 5 onward) -->
        {#if statRecords.length > 0 || !recordTrack.isSideLeague}
          <section class="sheet-section" aria-labelledby="hof-records">
            <div class="sheet-head">
              <h2 class="sheet-title" id="hof-records">Stat records</h2>
            </div>
            <div class="sheet-body">
              {#if statRecords.length > 0}
                <p class="sheet-note records-note">
                  Best single-map performances from imported matches{#if !recordTrack.isSideLeague},
                    tracked from Season 5 onward{/if} · {statRecords.length}
                  records
                </p>
                <div class="record-grid">
                  {#each statRecords as record (record.category)}
                    {@render statRecordTile(record)}
                  {/each}
                </div>
              {:else}
                <p class="empty-line">
                  No records in this book yet.{#if !recordTrack.isSideLeague}
                    Stat records are tracked from Season 5 onward.{/if}
                </p>
              {/if}
            </div>
          </section>
        {/if}

        <!-- Hand-made records -->
        {#if records.length > 0}
          <section class="sheet-section" aria-labelledby="hof-notable">
            <div class="sheet-head">
              <h2 class="sheet-title" id="hof-notable">Notable records</h2>
            </div>
            <div class="sheet-body">
              <ul class="plain-list">
                {#each records as record (record.id)}
                  <li class="plain-row">
                    <div class="plain-main">
                      <span class="plain-title">{record.title}</span>
                      {#if record.stat_value}
                        <span class="plain-value">
                          {record.stat_value}{#if record.stat_label}<span class="rec-unit"
                              >{record.stat_label}</span
                            >{/if}
                        </span>
                      {/if}
                      {#if record.holder}
                        {#if record.holder.id}
                          <a href={resolve(`/players/${record.holder.id}`)} class="plain-holder">
                            {record.holder.name}
                          </a>
                        {:else}
                          <span class="plain-holder">{record.holder.name}</span>
                        {/if}
                      {/if}
                      {#if record.description}<p class="plain-desc">{record.description}</p>{/if}
                    </div>
                    {#if record.season}<span class="plain-season">{record.season.code}</span>{/if}
                  </li>
                {/each}
              </ul>
            </div>
          </section>
        {/if}

        <!-- Awards -->
        {#if awards.length > 0}
          <section class="sheet-section" aria-labelledby="hof-accolades">
            <div class="sheet-head">
              <h2 class="sheet-title" id="hof-accolades">Accolades</h2>
            </div>
            <div class="sheet-body">
              <ul class="plain-list">
                {#each awards as award (award.id)}
                  <li class="plain-row">
                    <div class="plain-main">
                      <span class="plain-title">{award.title}</span>
                      {#if award.holder}
                        {#if award.holder.id}
                          <a href={resolve(`/players/${award.holder.id}`)} class="plain-holder">
                            {award.holder.name}
                          </a>
                        {:else}
                          <span class="plain-holder">{award.holder.name}</span>
                        {/if}
                      {/if}
                      {#if award.description}<p class="plain-desc">{award.description}</p>{/if}
                    </div>
                    {#if award.season}<span class="plain-season">{award.season.code}</span>{/if}
                  </li>
                {/each}
              </ul>
            </div>
          </section>
        {/if}

        <!-- Moments -->
        {#if moments.length > 0}
          <section class="sheet-section" aria-labelledby="hof-moments">
            <div class="sheet-head">
              <h2 class="sheet-title" id="hof-moments">Moments</h2>
            </div>
            <div class="sheet-body">
              <div class="moment-grid">
                {#each moments as moment (moment.id)}
                  <div class="moment">
                    {#if moment.media_url}
                      <ClipPlayer url={moment.media_url} title={moment.title} />
                    {/if}
                    <div class="moment-title">{moment.title}</div>
                    <div class="moment-meta">
                      {#if moment.holder}
                        {#if moment.holder.id}
                          <a href={resolve(`/players/${moment.holder.id}`)}>{moment.holder.name}</a>
                        {:else}
                          {moment.holder.name}
                        {/if}
                      {/if}
                      {#if moment.season}
                        <span>· {moment.season.code}</span>
                      {/if}
                      {#if moment.match}
                        <span>·</span>
                        <a href={resolve(`/matches/${moment.match.id}`)}>
                          {moment.match.label}{#if moment.match.scheduledAt}
                            · {formatDate(moment.match.scheduledAt)}{/if}
                        </a>
                      {/if}
                    </div>
                    {#if moment.description}<p class="moment-desc">{moment.description}</p>{/if}
                  </div>
                {/each}
              </div>
            </div>
          </section>
        {/if}
      </div>
    {/if}
  </div>
</PageContainer>

<style src="./page.css"></style>
