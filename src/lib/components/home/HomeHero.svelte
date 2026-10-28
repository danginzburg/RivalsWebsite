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
          <a href={resolve('/rulebook')} class="btn btn-ghost"><BookOpen size={16} /> Rulebook</a>
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

<style>
  .hero {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    width: 100%;
    border-radius: 1.25rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background:
      radial-gradient(ellipse 70% 90% at 0% 0%, rgba(81, 47, 138, 0.75), transparent 70%),
      radial-gradient(ellipse 60% 80% at 100% 100%, rgba(232, 17, 67, 0.16), transparent 70%),
      linear-gradient(160deg, #241a3a 0%, var(--background) 100%);
    padding: clamp(1.5rem, 4vw, 3.25rem);
  }

  /* Drifting strip of this season's team logos along the bottom edge. */
  .hero-marquee {
    margin: 1.5rem calc(-1 * clamp(1.5rem, 4vw, 3.25rem)) calc(-0.5 * clamp(1.5rem, 4vw, 3.25rem));
    overflow: hidden;
    opacity: 0.45;
    mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  }

  .hero-marquee-track {
    display: flex;
    gap: 1.5rem;
    width: max-content;
    animation: marquee 60s linear infinite;
  }

  .hero-marquee-logo {
    width: 3rem;
    height: 3rem;
    object-fit: contain;
    border-radius: 0.5rem;
    filter: grayscale(0.85);
  }

  @keyframes marquee {
    to {
      transform: translateX(-50%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hero-marquee-track {
      animation: none;
    }
  }

  .hero-inner {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: clamp(1.5rem, 4vw, 3.5rem);
    align-items: center;
  }

  .hero-copy {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
  }

  .hero-logo {
    width: clamp(5.5rem, 10vw, 7.5rem);
    height: auto;
    rotate: -6deg;
    filter: drop-shadow(0 8px 24px rgba(0, 0, 0, 0.45));
    margin-bottom: 1rem;
  }

  .hero-eyebrow {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-text);
    margin-bottom: 0.75rem;
  }

  .eyebrow-sep {
    opacity: 0.5;
  }

  .hero-logo-season {
    border-radius: 1rem;
    border: 2px solid rgba(255, 255, 255, 0.14);
  }

  .phase-chip {
    padding: 0.0625rem 0.4375rem;
    border-radius: 0.25rem;
    background: rgba(192, 132, 252, 0.16);
    color: var(--heading);
  }

  .week-placeholder {
    padding: 0.0625rem 0.4375rem;
    border-radius: 0.25rem;
    border: 1px dashed rgba(252, 211, 77, 0.55);
    color: #fcd34d;
  }

  .hero-title {
    font-size: clamp(2.125rem, 5.5vw, 4rem);
    font-weight: 700;
    line-height: 1.02;
    letter-spacing: -0.01em;
    color: var(--title);
    text-wrap: balance;
    overflow-wrap: anywhere;
  }

  .title-vs {
    font-size: 0.5em;
    color: rgba(255, 255, 255, 0.5);
    vertical-align: middle;
  }

  .hero-lede {
    margin-top: 1rem;
    max-width: 34rem;
    font-size: clamp(0.9375rem, 1.4vw, 1.0625rem);
    line-height: 1.55;
    color: rgba(255, 255, 255, 0.72);
  }

  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 1.75rem;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    border-radius: 0.625rem;
    font-size: 0.9375rem;
    font-weight: 700;
    text-decoration: none;
    transition:
      background 0.15s,
      border-color 0.15s,
      transform 0.15s;
  }

  .btn:hover {
    transform: translateY(-1px);
  }

  .btn-primary {
    background: var(--accent);
    color: var(--text);
    border: 1px solid rgba(255, 255, 255, 0.35);
    box-shadow: 0 6px 24px rgba(94, 52, 114, 0.55);
  }

  .btn-primary:hover {
    background: var(--hover);
  }

  .btn-ghost {
    color: var(--text);
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(0, 0, 0, 0.2);
  }

  .btn-ghost:hover {
    border-color: rgba(255, 255, 255, 0.32);
    background: rgba(255, 255, 255, 0.05);
  }

  .hero-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .hero-chips:empty {
    display: none;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.3125rem 0.75rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(0, 0, 0, 0.2);
    text-decoration: none;
  }

  .chip:hover {
    color: var(--text);
    border-color: rgba(255, 255, 255, 0.3);
  }

  .chip-pickem {
    color: #fcd34d;
    border-color: rgba(252, 211, 77, 0.35);
  }

  .live-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: rgba(74, 222, 128, 0.14);
    color: #4ade80;
    letter-spacing: 0.1em;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4ade80;
    animation: pulse-live 1.5s ease-in-out infinite;
  }

  @keyframes pulse-live {
    50% {
      opacity: 0.35;
    }
  }

  /* Featured match card */
  .feature-card {
    display: block;
    padding: 1.25rem 1.5rem 1.5rem;
    border-radius: 1rem;
    border: 1px solid rgba(192, 132, 252, 0.35);
    background:
      radial-gradient(ellipse 80% 60% at 50% 0%, rgba(192, 132, 252, 0.22), transparent 70%),
      linear-gradient(160deg, rgba(120, 67, 145, 0.7), rgba(57, 32, 97, 0.75));
    backdrop-filter: blur(6px);
    color: var(--text);
    text-decoration: none;
    box-shadow:
      0 20px 50px rgba(94, 52, 114, 0.45),
      inset 0 1px 0 rgba(255, 255, 255, 0.12);
    transition:
      border-color 0.15s,
      transform 0.15s;
  }

  .feature-card:hover {
    border-color: rgba(192, 132, 252, 0.65);
    transform: translateY(-2px);
  }

  .feature-live {
    border-color: rgba(74, 222, 128, 0.35);
  }

  .feature-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.25rem;
  }

  .feature-label {
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-text);
  }

  .feature-countdown {
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--accent-text);
    font-variant-numeric: tabular-nums;
  }

  .feature-teams {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 0.75rem;
  }

  .feature-team {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    text-align: center;
  }

  .feature-logo {
    width: clamp(3.5rem, 7vw, 5rem);
    height: clamp(3.5rem, 7vw, 5rem);
    object-fit: contain;
    border-radius: 0.5rem;
  }

  .feature-logo-blank {
    background: rgba(255, 255, 255, 0.06);
  }

  .feature-name {
    max-width: 100%;
    font-size: 1rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .feature-vs {
    font-size: 0.875rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    font-variant-numeric: tabular-nums;
  }

  .feature-score {
    font-size: 1.75rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .feature-score-win {
    color: #4ade80;
  }

  .feature-score-sep {
    margin: 0 0.25rem;
    opacity: 0.6;
  }

  .feature-meta {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1.25rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.55);
  }

  /* Stats strip */
  .hero-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 2.5rem;
    margin-top: clamp(1.75rem, 4vw, 2.75rem);
    padding-top: 1.25rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .hero-stats div {
    display: flex;
    flex-direction: column-reverse;
  }

  .hero-stats dt {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
  }

  .hero-stats dd {
    color: var(--heading);
    font-size: 1.625rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 860px) {
    .hero-inner {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 480px) {
    .hero {
      border-radius: 1rem;
    }

    .hero-actions {
      width: 100%;
    }

    .btn {
      flex: 1 1 100%;
      justify-content: center;
    }

    .hero-stats {
      gap: 0.75rem 1.5rem;
    }
  }
</style>
