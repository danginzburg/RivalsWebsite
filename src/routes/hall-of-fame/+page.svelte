<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import { Award, Trophy, Crown, Flame, Zap, TrendingUp } from 'lucide-svelte'
  import ClipPlayer from '$lib/components/ClipPlayer.svelte'
  import { resolve } from '$app/paths'

  let { data }: PageProps = $props()

  const records = $derived(data.records ?? [])
  const moments = $derived(data.moments ?? [])
  const awards = $derived(data.awards ?? [])
  const seasonChampions = $derived(data.seasonChampions ?? [])
  const statRecords = $derived(data.statRecords ?? [])
  const recordTrack = $derived(data.recordTrack)

  type StatRecord = PageProps['data']['statRecords'][number]
  type Holderish = {
    holderKind: 'player' | 'team'
    holder: { id: string | null; name: string } | null
    team: { id: string; name: string; tag: string | null } | null
    opponent: { id: string; name: string; tag: string | null } | null
    context: Record<string, unknown>
  }

  function formatDate(iso: string | null) {
    if (!iso) return null
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  /**
   * A team record is a map two teams played, so both are named — winner first.
   * The short form (tags) fits the narrow ranked rows under the #1.
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

  const isEmpty = $derived(
    statRecords.length === 0 &&
      records.length === 0 &&
      moments.length === 0 &&
      awards.length === 0 &&
      seasonChampions.length === 0
  )
</script>

<svelte:head><title>Hall of Fame</title></svelte:head>

{#snippet statRecordCard(record: StatRecord)}
  {@const leader = record.top[0]}
  <!-- Just how much and who; each line opens the match for the rest. -->
  <div class="record-card stat-card">
    <span class="record-title">{record.title}</span>
    <a href={resolve(`/matches/${leader.matchId}`)} class="record-lead">
      <span class="record-stat">
        <span class="record-value">{leader.value}</span>
        <span class="record-unit">{leader.unit}</span>
      </span>
      <span class="record-holder">{holderName(leader)}</span>
    </a>
    {#if record.description}
      <p class="record-desc">{record.description}</p>
    {/if}
    {#if record.top.length > 1}
      <ol class="runner-list">
        {#each record.top.slice(1) as entry (entry.entryKey)}
          <li>
            <a
              href={resolve(`/matches/${entry.matchId}`)}
              class="runner-row"
              class:rank-silver={entry.rank === 2}
              class:rank-bronze={entry.rank === 3}
            >
              <span class="runner-value">{entry.value}</span>
              <span class="runner-who">{holderName(entry, true)}</span>
            </a>
          </li>
        {/each}
      </ol>
    {/if}
    {#if record.hiddenTies > 0}
      <p class="record-ties" title="Performances level with the last one listed that didn't fit">
        {#if record.viewerTiedOff && record.hiddenTies === 1}
          You're also tied at {record.top.at(-1)?.value}
        {:else if record.viewerTiedOff}
          You and {record.hiddenTies - 1} more tied at {record.top.at(-1)?.value}
        {:else}
          +{record.hiddenTies} more tied at {record.top.at(-1)?.value}
        {/if}
      </p>
    {/if}
  </div>
{/snippet}

<PageContainer>
  <div class="page-content py-6">
    <PageHeading
      title="Hall of Fame"
      subtitle="Records, champions, and the moments worth remembering."
      icon={Award}
    ></PageHeading>

    {#if isEmpty}
      <div class="empty-state">
        <Award size={40} style="color: rgba(255,255,255,0.48);" />
        <p class="empty-title">Nothing enshrined yet</p>
        <p class="empty-text">
          Season champions appear here automatically once a winner is set on a season. Stat records
          are tracked from Season 5 on and fill in as matches are imported. Moments are added from
          the admin panel.
        </p>
      </div>
    {/if}

    <!-- Champions -->
    {#if seasonChampions.length > 0}
      <section class="hof-section">
        <h2 class="section-title">
          <Trophy size={16} style="color: #fcd34d;" />
          Season Champions
        </h2>
        <div class="champion-grid four-up">
          {#each seasonChampions as champ (champ.code)}
            <div class="champion-card">
              <a href={resolve(`/events/${champ.code}`)} class="champion-season">{champ.name}</a>
              {#if champ.winner}
                <a href={resolve(`/teams/${champ.winner.id}`)} class="champion-team">
                  {#if champ.winner.logo_url}
                    <img src={champ.winner.logo_url} alt="" class="champion-logo" />
                  {:else}
                    <div class="champion-logo champion-logo-blank"></div>
                  {/if}
                  <span class="champion-name">{champ.winner.name}</span>
                </a>
              {/if}
              {#if champ.mvp?.id}
                <a href={resolve(`/players/${champ.mvp.id}`)} class="champion-mvp">
                  <Crown size={12} style="color: #c084fc;" />
                  MVP · {champ.mvp.name}
                </a>
              {:else if champ.mvp}
                <span class="champion-mvp">
                  <Crown size={12} style="color: #c084fc;" />
                  MVP · {champ.mvp.name}
                </span>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Stat records (generated from match stats, Season 5 onward) -->
    {#if statRecords.length > 0}
      <section class="hof-section">
        <h2 class="section-title">
          <TrendingUp size={16} style="color: #34d399;" />
          {recordTrack.isSideLeague ? `${recordTrack.label} Records` : 'Stat Records'}
        </h2>
        <div class="record-grid four-up">
          {#each statRecords as record (record.category)}
            {@render statRecordCard(record)}
          {/each}
        </div>
      </section>
    {/if}

    <!-- Records -->
    {#if records.length > 0}
      <section class="hof-section">
        <h2 class="section-title">
          <Zap size={16} style="color: #60a5fa;" />
          Notable Records
        </h2>
        <div class="record-grid">
          {#each records as record (record.id)}
            <div class="record-card">
              <div class="record-head">
                <span class="record-title">{record.title}</span>
                {#if record.season}
                  <span class="record-season">{record.season.code}</span>
                {/if}
              </div>
              {#if record.stat_value}
                <div class="record-stat">
                  <span class="record-value">{record.stat_value}</span>
                  {#if record.stat_label}
                    <span class="record-unit">{record.stat_label}</span>
                  {/if}
                </div>
              {/if}
              {#if record.holder}
                {#if record.holder.id}
                  <a href={resolve(`/players/${record.holder.id}`)} class="record-holder">
                    {record.holder.name}
                  </a>
                {:else}
                  <span class="record-holder record-holder-plain">{record.holder.name}</span>
                {/if}
              {/if}
              {#if record.description}
                <p class="record-desc">{record.description}</p>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Awards -->
    {#if awards.length > 0}
      <section class="hof-section">
        <h2 class="section-title">
          <Award size={16} style="color: #c084fc;" />
          Accolades
        </h2>
        <div class="award-list">
          {#each awards as award (award.id)}
            <div class="award-row">
              <div class="award-main">
                <span class="award-title">{award.title}</span>
                {#if award.holder}
                  <span class="award-sep">·</span>
                  {#if award.holder.id}
                    <a href={resolve(`/players/${award.holder.id}`)} class="award-holder">
                      {award.holder.name}
                    </a>
                  {:else}
                    <span class="award-holder">{award.holder.name}</span>
                  {/if}
                {/if}
                {#if award.description}
                  <p class="award-desc">{award.description}</p>
                {/if}
              </div>
              {#if award.season}
                <span class="award-season">{award.season.code}</span>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Moments -->
    {#if moments.length > 0}
      <section class="hof-section">
        <h2 class="section-title">
          <Flame size={16} style="color: #fb923c;" />
          Moments
        </h2>
        <div class="moment-grid">
          {#each moments as moment (moment.id)}
            <div class="moment-card">
              <div class="moment-head">
                <span class="moment-title">{moment.title}</span>
                {#if moment.season}
                  <span class="moment-season">{moment.season.code}</span>
                {/if}
              </div>
              {#if moment.holder}
                <div class="moment-holder">
                  {#if moment.holder.id}
                    <a href={resolve(`/players/${moment.holder.id}`)}>{moment.holder.name}</a>
                  {:else}
                    {moment.holder.name}
                  {/if}
                </div>
              {/if}
              {#if moment.description}
                <p class="moment-desc">{moment.description}</p>
              {/if}
              {#if moment.match}
                <a href={resolve(`/matches/${moment.match.id}`)} class="moment-match">
                  {moment.match.label}
                  {#if moment.match.scheduledAt}· {formatDate(moment.match.scheduledAt)}{/if}
                </a>
              {/if}
              {#if moment.media_url}
                <ClipPlayer url={moment.media_url} title={moment.title} />
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/if}
  </div>
</PageContainer>

<style>
  .hof-section {
    margin-bottom: 2rem;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 0.4375rem;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 0.75rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  /* Champions */
  .champion-grid {
    display: grid;
  }

  .champion-card {
    padding: 1.25rem;
    border-radius: 0.625rem;
    border: 1px solid rgba(252, 211, 77, 0.22);
    background: linear-gradient(180deg, rgba(252, 211, 77, 0.07) 0%, rgba(0, 0, 0, 0.22) 100%);
  }

  .champion-season {
    display: block;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.62);
    text-decoration: none;
    margin-bottom: 0.5rem;
  }

  .champion-season:hover {
    color: var(--accent-text);
  }

  .champion-team {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    text-decoration: none;
    color: var(--text);
  }

  .champion-logo {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 0.25rem;
    object-fit: contain;
    flex-shrink: 0;
  }

  .champion-logo-blank {
    background: rgba(255, 255, 255, 0.06);
  }

  /* Long team names wrap rather than being cut off. */
  .champion-name {
    min-width: 0;
    font-size: 1.125rem;
    font-weight: 700;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .champion-team:hover .champion-name {
    color: #fcd34d;
  }

  .champion-mvp {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.5);
    text-decoration: none;
    margin-top: 0.625rem;
  }

  a.champion-mvp:hover {
    color: #c084fc;
  }

  /* Records */
  .record-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.625rem;
  }

  .record-card {
    padding: 1rem;
    border-radius: 0.625rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.22);
  }

  .record-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .record-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.6);
  }

  .record-season {
    font-size: 0.5625rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.56);
    flex-shrink: 0;
  }

  .record-stat {
    display: flex;
    align-items: baseline;
    gap: 0.3125rem;
    margin: 0.375rem 0 0.25rem;
  }

  .record-value {
    font-size: 1.75rem;
    font-weight: 700;
    color: #60a5fa;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .record-unit {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.64);
  }

  .record-holder {
    display: inline-block;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
  }

  a.record-holder:hover {
    color: var(--accent-text);
  }

  .record-holder-plain {
    color: rgba(255, 255, 255, 0.7);
  }

  /* Stat record cards: fewer details than a hand-made record, so bigger type. */
  /* Champions and stat records: four across on a desktop, fewer as the screen narrows. */
  .four-up {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.875rem;
  }

  @media (max-width: 1100px) {
    .four-up {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 820px) {
    .four-up {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 540px) {
    .four-up {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  /* A column, so the tie note can sit at the bottom of a card stretched to its row. */
  .stat-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 1.25rem;
  }

  .stat-card > .record-lead,
  .stat-card > .runner-list {
    align-self: stretch;
  }

  .stat-card .record-title {
    font-size: 0.9375rem;
    color: rgba(255, 255, 255, 0.75);
  }

  /* Podium colours: gold for the record, silver and bronze behind it. */
  .stat-card .record-value {
    font-size: 2.5rem;
    color: #fcd34d;
  }

  .rank-silver .runner-value {
    color: #e2e8f0;
  }

  .rank-bronze .runner-value {
    color: #e0a36b;
  }

  .stat-card .record-unit {
    font-size: 0.9375rem;
  }

  .stat-card .record-holder {
    font-size: 1.125rem;
  }

  .stat-card .record-desc {
    font-size: 0.875rem;
  }

  /* A stat record line is one link to the match it happened in. */
  .record-lead {
    display: block;
    margin: 0.25rem -0.375rem 0;
    padding: 0.25rem 0.375rem;
    border-radius: 0.375rem;
    color: var(--text);
    text-decoration: none;
    transition: background 0.12s;
  }

  .record-lead .record-stat {
    margin: 0 0 0.125rem;
  }

  .record-lead:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .record-lead:hover .record-holder {
    color: var(--accent-text);
  }

  .record-ties {
    margin-top: auto;
    padding-top: 0.5rem;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    color: #fcd34d;
  }

  .runner-list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    margin-top: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .runner-row {
    display: grid;
    grid-template-columns: 4rem minmax(0, 1fr);
    align-items: baseline;
    gap: 0.5rem;
    margin: 0 -0.375rem;
    padding: 0.3125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.9375rem;
    color: rgba(255, 255, 255, 0.92);
    text-decoration: none;
    transition: background 0.12s;
  }

  .runner-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .runner-row:hover .runner-who {
    color: var(--accent-text);
  }

  .runner-value {
    font-weight: 700;
    color: #93c5fd;
    font-variant-numeric: tabular-nums;
  }

  .runner-who {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .record-desc {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    line-height: 1.5;
    margin-top: 0.375rem;
  }

  /* Awards */
  .award-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .award-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(0, 0, 0, 0.2);
  }

  .award-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text);
  }

  .award-sep {
    color: rgba(255, 255, 255, 0.48);
    margin: 0 0.25rem;
  }

  .award-holder {
    font-size: 0.875rem;
    color: #c084fc;
    text-decoration: none;
  }

  a.award-holder:hover {
    text-decoration: underline;
  }

  .award-desc {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    line-height: 1.5;
    margin-top: 0.25rem;
  }

  .award-season {
    font-size: 0.5625rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.56);
    flex-shrink: 0;
    padding-top: 0.1875rem;
  }

  /* Moments */
  .moment-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 0.625rem;
  }

  .moment-card {
    padding: 1rem;
    border-radius: 0.625rem;
    border: 1px solid rgba(251, 146, 60, 0.18);
    background: rgba(251, 146, 60, 0.04);
  }

  .moment-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .moment-title {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--text);
  }

  .moment-season {
    font-size: 0.5625rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.56);
    flex-shrink: 0;
  }

  .moment-holder {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.55);
    margin-top: 0.1875rem;
  }

  .moment-holder a {
    color: rgba(255, 255, 255, 0.55);
    text-decoration: none;
  }

  .moment-holder a:hover {
    color: var(--accent-text);
  }

  .moment-desc {
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.65);
    line-height: 1.55;
    margin-top: 0.5rem;
  }

  .moment-match {
    display: inline-block;
    margin-top: 0.375rem;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.55);
    text-decoration: none;
  }

  .moment-match:hover {
    color: var(--accent-text);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    text-align: center;
    padding: 4rem 1.5rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.18);
  }

  .empty-title {
    font-size: 1rem;
    font-weight: 600;
  }

  .empty-text {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.5);
    max-width: 32rem;
    line-height: 1.55;
  }
</style>
