<script lang="ts">
  import { resolve } from '$app/paths'
  import { ArrowRight, Radio, Target, Trophy, ClipboardList, BookOpen } from 'lucide-svelte'
  import DiscordIcon from '$lib/components/icons/DiscordIcon.svelte'
  import TeamSeed from '$lib/components/TeamSeed.svelte'
  import tcRivalsLogo from '$lib/assets/img/tcrivals.png'
  import { localDateKey, seasonPhaseLabel, type SeasonSchedule } from '$lib/seasons/schedule'

  type HeroTeam = { id: string; name: string; logo_url: string | null } | null
  type HeroMatch = {
    id: string
    status: string
    best_of: number
    scheduled_at: string | null
    team_a_score: number | null
    team_b_score: number | null
    team_a: HeroTeam
    team_b: HeroTeam
    streams?: Array<{ stream_url: string | null }>
  }

  interface Props {
    season: {
      id: string
      code: string
      name: string
      startsOn: string | null
      endsOn: string | null
      logoUrl: string | null
      schedule: SeasonSchedule
    } | null
    /** The next tournament, when it takes signups while another season is active. */
    upcomingSignup: {
      id: string
      code: string
      name: string
      startsOn: string | null
      logoUrl: string | null
    } | null
    /** Signups for the active season itself, which never close mid-season. */
    signupsOpen: boolean
    /** The signup hero links to the rulebook only once it's published. */
    rulebookPublished: boolean
    hasActivePickem: boolean
    liveMatch: HeroMatch | null
    nextMatch: HeroMatch | null
    /** Shown in the feature slot when nothing is live or scheduled. */
    latestResult: HeroMatch | null
    seeds: Record<string, number>
    logos: string[]
    stats: { teams: number; players: number; matchesPlayed: number }
    now: number
  }

  let {
    season,
    upcomingSignup,
    signupsOpen,
    rulebookPublished,
    hasActivePickem,
    liveMatch,
    nextMatch,
    latestResult,
    seeds,
    logos,
    stats,
    now,
  }: Props = $props()

  /** "Week 3", "Play-ins", "Playoffs"… from the stage dates set in admin. */
  const phaseLabel = $derived(
    season
      ? seasonPhaseLabel(
          season.schedule,
          { startsOn: season.startsOn, endsOn: season.endsOn },
          localDateKey(new Date(now))
        )
      : null
  )

  /** A season other than the active one taking signups — the next season. */
  const nextSeasonSignups = $derived(upcomingSignup)

  const streamUrl = $derived(liveMatch?.streams?.find((s) => s.stream_url)?.stream_url ?? null)

  /**
   * A live match only takes over the hero when there is a stream to send people
   * to — scores don't update live and most matches aren't streamed, so without
   * one the season display stays and the feature card just reads "Live".
   */
  const mode = $derived<'live' | 'signups' | 'season' | 'offseason'>(
    liveMatch && streamUrl
      ? 'live'
      : nextSeasonSignups
        ? 'signups'
        : season
          ? 'season'
          : 'offseason'
  )

  const featured = $derived(liveMatch ?? nextMatch ?? latestResult)
  const featuredKind = $derived<'live' | 'next' | 'result'>(
    liveMatch ? 'live' : nextMatch ? 'next' : 'result'
  )
  /** Enough copies of the logo strip to cover wide screens before it loops. */
  const marquee = $derived.by(() => {
    if (logos.length === 0) return []
    const copies = Math.max(1, Math.ceil(12 / logos.length))
    return Array.from({ length: copies }, () => logos).flat()
  })

  function countdown(iso: string | null): string | null {
    if (!iso) return null
    const ms = Date.parse(iso) - now
    if (ms <= 0) return 'Starting now'
    const mins = Math.floor(ms / 60_000)
    const days = Math.floor(mins / 1440)
    const hours = Math.floor((mins % 1440) / 60)
    if (days > 0) return `in ${days}d ${hours}h`
    if (hours > 0) return `in ${hours}h ${mins % 60}m`
    return `in ${Math.max(1, mins)}m`
  }

  function formatWhen(iso: string | null) {
    if (!iso) return 'Date TBD'
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  }

  /** A `YYYY-MM-DD` date as "Nov 2", read as a calendar day. */
  function formatDay(dateKey: string) {
    return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })
  }

  function seedOf(team: HeroTeam) {
    return team ? (seeds[team.id] ?? null) : null
  }
</script>

<section class="hero" aria-labelledby="hero-title">
  <div class="hero-inner">
    <div class="hero-copy">
      <!-- During signups the hero is about the upcoming tournament, not the active one. -->
      {#if mode === 'signups' && nextSeasonSignups?.logoUrl}
        <img
          src={nextSeasonSignups.logoUrl}
          alt="{nextSeasonSignups.name} logo"
          class="hero-logo hero-logo-season"
        />
      {:else if mode !== 'signups' && season?.logoUrl}
        <img src={season.logoUrl} alt="{season.name} logo" class="hero-logo hero-logo-season" />
      {:else}
        <img src={tcRivalsLogo} alt="TC Rivals" class="hero-logo" />
      {/if}

      <div class="hero-eyebrow">
        {#if mode === 'live'}
          <span class="live-pill"><span class="live-dot"></span>Live now</span>
        {/if}
        {#if mode === 'signups' && nextSeasonSignups}
          <span>{nextSeasonSignups.name}</span>
          <span class="eyebrow-sep">·</span>
          <span class="phase-chip">
            {nextSeasonSignups.startsOn
              ? `Starts ${formatDay(nextSeasonSignups.startsOn)}`
              : 'Signups open'}
          </span>
        {:else if season}
          <span>{season.name}</span>
          <span class="eyebrow-sep">·</span>
          {#if phaseLabel}
            <span class="phase-chip">{phaseLabel}</span>
          {:else}
            <!-- Stays visible until stage dates are set in Admin → Seasons. -->
            <span class="week-placeholder" title="Set stage dates in Admin → Seasons">Week TBD</span
            >
          {/if}
        {:else}
          <span>NA community Valorant league</span>
        {/if}
      </div>

      <h1 id="hero-title" class="hero-title">
        {#if mode === 'live'}
          {liveMatch?.team_a?.name ?? 'TBD'} <span class="title-vs">vs</span>
          {liveMatch?.team_b?.name ?? 'TBD'}
        {:else if mode === 'signups'}
          {nextSeasonSignups?.name} signups are open
        {:else if mode === 'season'}
          The race for {season?.name} is on
        {:else}
          TC Rivals
        {/if}
      </h1>

      <p class="hero-lede">
        {#if mode === 'live'}
          A match is underway right now. Catch it live on stream.
        {:else if mode === 'signups'}
          Get on the list for the next season before rosters are built.
        {:else if mode === 'season'}
          Matches, live stats, and standings all season long.
        {:else}
          An NA community Valorant league. Between seasons — join the Discord to hear when the next
          one starts.
        {/if}
      </p>

      <div class="hero-actions">
        {#if mode === 'live' && liveMatch && streamUrl}
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a href={streamUrl} target="_blank" rel="noopener noreferrer" class="btn btn-primary">
            <Radio size={17} /> Watch live
          </a>
          <a href={resolve(`/matches/${liveMatch.id}`)} class="btn btn-ghost">
            Match page <ArrowRight size={16} />
          </a>
        {:else if mode === 'signups'}
          <a href={resolve('/signup')} class="btn btn-primary">
            <ClipboardList size={17} /> Sign up
          </a>
          {#if rulebookPublished}
            <a href={resolve('/rulebook')} class="btn btn-ghost"><BookOpen size={16} /> Rulebook</a>
          {/if}
        {:else if mode === 'season'}
          <a href={resolve('/leaderboard')} class="btn btn-primary">
            <Trophy size={17} /> Standings
          </a>
          <a href={resolve('/matches')} class="btn btn-ghost">
            Full schedule <ArrowRight size={16} />
          </a>
        {:else}
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a
            href="https://discord.gg/JpTYg2662C"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-primary"
          >
            <DiscordIcon size={18} /> Join the Discord
          </a>
          <a href={resolve('/events')} class="btn btn-ghost">
            Past seasons <ArrowRight size={16} />
          </a>
        {/if}
      </div>

      <div class="hero-chips">
        {#if hasActivePickem}
          <a href={resolve('/pickems')} class="chip chip-pickem">
            <Target size={14} /> Pick'ems are open
          </a>
        {/if}
        {#if signupsOpen && mode !== 'signups'}
          <a href={resolve('/signup')} class="chip">
            <ClipboardList size={14} /> Signups open
          </a>
        {/if}
      </div>
    </div>

    {#if featured}
      <a
        href={resolve(`/matches/${featured.id}`)}
        class="feature-card"
        class:feature-live={featuredKind === 'live'}
      >
        <div class="feature-head">
          {#if featuredKind === 'live'}
            <span class="live-pill"><span class="live-dot"></span>Live</span>
          {:else if featuredKind === 'next'}
            <span class="feature-label">Up next</span>
            <span class="feature-countdown">{countdown(featured.scheduled_at) ?? 'TBD'}</span>
          {:else}
            <span class="feature-label">Latest result</span>
          {/if}
        </div>

        <div class="feature-teams">
          {#each [featured.team_a, featured.team_b] as team, i (i)}
            <div class="feature-team">
              {#if team?.logo_url}
                <img src={team.logo_url} alt="" class="feature-logo" />
              {:else}
                <div class="feature-logo feature-logo-blank"></div>
              {/if}
              <strong class="feature-name">{team?.name ?? 'TBD'}</strong>
              <TeamSeed seed={seedOf(team)} label="Leaderboard rank" />
            </div>
            {#if i === 0}
              <span class="feature-vs">
                {#if featuredKind === 'result'}
                  {@const a = featured.team_a_score ?? 0}
                  {@const b = featured.team_b_score ?? 0}
                  <span class="feature-score">
                    <span class:feature-score-win={featuredKind === 'result' && a > b}>{a}</span
                    ><span class="feature-score-sep">–</span><span
                      class:feature-score-win={featuredKind === 'result' && b > a}>{b}</span
                    >
                  </span>
                {:else}
                  vs
                {/if}
              </span>
            {/if}
          {/each}
        </div>

        <div class="feature-meta">
          <span>BO{featured.best_of}</span>
          <span class="eyebrow-sep">·</span>
          <span>{formatWhen(featured.scheduled_at)}</span>
        </div>
      </a>
    {/if}
  </div>

  <!-- Stats and team logos describe the active season, so they step aside while
       the hero is promoting the next one. -->
  {#if season && mode !== 'signups'}
    <dl class="hero-stats">
      <div>
        <dt>Teams</dt>
        <dd>{stats.teams}</dd>
      </div>
      <div>
        <dt>Players</dt>
        <dd>{stats.players}</dd>
      </div>
      <div>
        <dt>Matches played</dt>
        <dd>{stats.matchesPlayed}</dd>
      </div>
    </dl>
  {/if}

  {#if marquee.length > 0 && mode !== 'signups'}
    <div class="hero-marquee" aria-hidden="true">
      <div class="hero-marquee-track">
        {#each [0, 1] as half (half)}
          {#each marquee as logo, i (`${half}-${i}`)}
            <img src={logo} alt="" class="hero-marquee-logo" loading="lazy" />
          {/each}
        {/each}
      </div>
    </div>
  {/if}
</section>

<style src="./HomeHero.css"></style>
