<script lang="ts">
  import type { PickemTeamRow } from '$lib/server/pickems'
  import type { PickemBucket } from '$lib/pickemBuckets'
  import { PICKEM_BUCKETS } from '$lib/pickemBuckets'
  import rivalsLogo from '$lib/assets/rivals_logo.png'

  type Props = {
    seasonName: string
    userName: string
    submittedAt: string | null
    baselineRows: PickemTeamRow[]
    bucketAssignments: Map<string, string>
  }

  let { seasonName, userName, submittedAt, baselineRows, bucketAssignments }: Props = $props()

  const bucketConfig: Record<PickemBucket, { label: string; accent: string; glow: string }> = {
    '3-0': { label: '3-0', accent: '#a78bfa', glow: 'rgba(167, 139, 250, 0.35)' },
    '2-1': { label: '2-1', accent: '#93c5fd', glow: 'rgba(147, 197, 253, 0.2)' },
    '1-2': { label: '1-2', accent: '#fbbf24', glow: 'rgba(251, 191, 36, 0.2)' },
    '0-3': { label: '0-3', accent: '#f87171', glow: 'rgba(248, 113, 113, 0.25)' },
  }

  function teamShortLabel(team: PickemTeamRow['team'], maxChars = 14) {
    if (!team) return 'Team'
    const tag = team.tag?.trim()
    if (tag) return tag.toUpperCase()
    const name = team.name?.trim() ?? 'Team'
    if (name.length <= maxChars) return name
    return `${name.slice(0, Math.max(1, maxChars - 1))}…`
  }

  const groupedBuckets = $derived.by(() => {
    const groups: Record<PickemBucket, PickemTeamRow[]> = {
      '3-0': [],
      '2-1': [],
      '1-2': [],
      '0-3': [],
    }
    for (const row of baselineRows) {
      const teamId = row.team?.id
      if (!teamId) continue
      const bucket = (bucketAssignments.get(teamId) ?? '2-1') as PickemBucket
      if (bucket in groups) groups[bucket].push(row)
    }
    for (const bucket of PICKEM_BUCKETS) {
      groups[bucket].sort((a, b) => a.rank - b.rank)
    }
    return groups
  })

  function formatDate(value: string | null) {
    if (!value) return ''
    const date = new Date(value)
    return Number.isFinite(date.getTime())
      ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : ''
  }
</script>

<div class="receipt" aria-label="Pick'em receipt for {userName}">
  <div class="receipt__header">
    <div class="receipt__brand">
      <img src={rivalsLogo} alt="" class="receipt__logo" />
      <div class="receipt__titles">
        <h2 class="receipt__season">{seasonName}</h2>
        <p class="receipt__subtitle">PICK'EM</p>
      </div>
    </div>
    <div class="receipt__meta">
      <span class="receipt__user">{userName}</span>
      {#if submittedAt}
        <span class="receipt__date">{formatDate(submittedAt)}</span>
      {/if}
    </div>
  </div>

  <div class="receipt__divider"></div>

  <div class="receipt__grid">
    {#each PICKEM_BUCKETS as bucket (bucket)}
      {@const cfg = bucketConfig[bucket]}
      {@const teams = groupedBuckets[bucket]}
      <div
        class="receipt__bucket receipt__bucket--{bucket}"
        class:receipt__bucket--wide={bucket === '2-1' || bucket === '1-2'}
        style="--bucket-accent: {cfg.accent}; --bucket-glow: {cfg.glow};"
      >
        <div class="receipt__bucket-header">
          <span class="receipt__bucket-label">{cfg.label}</span>
        </div>
        <div class="receipt__bucket-teams">
          {#each teams as row (row.team?.id ?? row.rank)}
            <div class="receipt__team" title={row.team?.name ?? 'Team'}>
              {#if row.team?.logo_url}
                <img src={row.team.logo_url} alt="" class="receipt__team-logo" />
              {:else}
                <div class="receipt__team-logo-placeholder"></div>
              {/if}
              <span class="receipt__team-name">{teamShortLabel(row.team)}</span>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .receipt {
    --receipt-bg: rgba(12, 10, 22, 0.92);
    --receipt-surface: rgba(255, 255, 255, 0.04);
    --receipt-border: rgba(94, 52, 114, 0.45);
    --receipt-border-subtle: rgba(255, 255, 255, 0.06);
    --receipt-text: #fff;
    --receipt-text-muted: rgba(255, 255, 255, 0.55);

    position: relative;
    max-width: 640px;
    margin: 0 auto;
    padding: 1.25rem 1.5rem 1rem;
    border-radius: 1rem;
    border: 1px solid var(--receipt-border);
    background: var(--receipt-bg);
    box-shadow:
      0 0 60px rgba(94, 52, 114, 0.18),
      0 0 0 1px rgba(0, 0, 0, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
    overflow: hidden;
  }

  .receipt::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      165deg,
      rgba(94, 52, 114, 0.12) 0%,
      transparent 40%,
      rgba(81, 47, 138, 0.08) 100%
    );
    pointer-events: none;
  }

  .receipt__header {
    position: relative;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .receipt__brand {
    display: flex;
    align-items: center;
    gap: 0.625rem;
  }

  .receipt__logo {
    width: 2rem;
    height: 2rem;
    object-fit: contain;
    filter: drop-shadow(0 0 8px rgba(94, 52, 114, 0.5));
  }

  .receipt__titles {
    display: flex;
    flex-direction: column;
  }

  .receipt__season {
    font-family: 'Nippo', ui-sans-serif, system-ui, sans-serif;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--receipt-text);
    letter-spacing: 0.02em;
    line-height: 1.2;
  }

  .receipt__subtitle {
    font-family: 'Nippo', ui-sans-serif, system-ui, sans-serif;
    font-size: 0.6rem;
    font-weight: 600;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: var(--accent, #5e3472);
    opacity: 0.85;
  }

  .receipt__meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.125rem;
    flex-shrink: 0;
  }

  .receipt__user {
    font-family: 'Nippo', ui-sans-serif, system-ui, sans-serif;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--receipt-text);
    letter-spacing: 0.04em;
  }

  .receipt__date {
    font-size: 0.6rem;
    color: var(--receipt-text-muted);
    letter-spacing: 0.03em;
  }

  .receipt__divider {
    position: relative;
    height: 1px;
    margin: 0.875rem 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      var(--receipt-border) 20%,
      var(--receipt-border) 80%,
      transparent 100%
    );
  }

  .receipt__grid {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .receipt__bucket {
    padding: 0.5rem 0.625rem;
    border-radius: 0.5rem;
    border: 1px solid var(--receipt-border-subtle);
    background: var(--receipt-surface);
    transition: border-color 0.2s;
  }

  .receipt__bucket--wide {
    grid-column: span 2;
  }

  .receipt__bucket--wide .receipt__bucket-teams {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.25rem 0.5rem;
  }

  .receipt__bucket-header {
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
    margin-bottom: 0.375rem;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--receipt-border-subtle);
  }

  .receipt__bucket-label {
    font-family: 'Nippo', ui-sans-serif, system-ui, sans-serif;
    font-size: 0.85rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: var(--bucket-accent);
    text-shadow: 0 0 14px var(--bucket-glow);
  }

  .receipt__bucket-count {
    font-size: 0.6rem;
    font-weight: 500;
    color: var(--receipt-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .receipt__bucket-teams {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .receipt__team {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.125rem 0;
  }

  .receipt__team-logo {
    width: 1rem;
    height: 1rem;
    border-radius: 2px;
    object-fit: contain;
    flex-shrink: 0;
  }

  .receipt__team-logo-placeholder {
    width: 1rem;
    height: 1rem;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .receipt__team-name {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--receipt-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
    letter-spacing: 0.01em;
  }

  .receipt__footer {
    position: relative;
    display: flex;
    justify-content: center;
    margin-top: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--receipt-border-subtle);
  }

  .receipt__watermark {
    font-family: 'Nippo', ui-sans-serif, system-ui, sans-serif;
    font-size: 0.55rem;
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.22);
  }

  @media (max-width: 480px) {
    .receipt {
      padding: 1rem 1rem 0.75rem;
      border-radius: 0.75rem;
    }

    .receipt__bucket--wide .receipt__bucket-teams {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  /* Wide screens: use horizontal space — flanking 3-0 / 0-3, wide center for 2-1 & 1-2 */
  @media (min-width: 900px) {
    .receipt {
      max-width: min(72rem, 100%);
      padding: 1.5rem 2rem 1.25rem;
    }

    .receipt__header {
      align-items: center;
    }

    .receipt__logo {
      width: 2.5rem;
      height: 2.5rem;
    }

    .receipt__season {
      font-size: 1.15rem;
    }

    .receipt__user {
      font-size: 0.85rem;
    }

    .receipt__grid {
      grid-template-columns: minmax(11rem, 1.1fr) minmax(18rem, 2.8fr) minmax(11rem, 1.1fr);
      grid-template-rows: 1fr 1fr;
      grid-template-areas:
        'b30 b21 b03'
        'b30 b12 b03';
      gap: 0.75rem 1rem;
      align-items: stretch;
    }

    .receipt__bucket--3-0 {
      grid-area: b30;
    }

    .receipt__bucket--2-1 {
      grid-area: b21;
    }

    .receipt__bucket--1-2 {
      grid-area: b12;
    }

    .receipt__bucket--0-3 {
      grid-area: b03;
    }

    .receipt__bucket--wide {
      grid-column: unset;
    }

    .receipt__bucket {
      padding: 0.625rem 0.75rem;
      min-height: 0;
    }

    /* Narrow flank columns: compact vertical stacks */
    .receipt__bucket--3-0 .receipt__bucket-teams,
    .receipt__bucket--0-3 .receipt__bucket-teams {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    /* Center: many columns so nine teams fit in ~2 rows */
    .receipt__bucket--2-1 .receipt__bucket-teams,
    .receipt__bucket--1-2 .receipt__bucket-teams {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0.3rem 0.65rem;
    }

    .receipt__team-logo,
    .receipt__team-logo-placeholder {
      width: 1.125rem;
      height: 1.125rem;
    }

    .receipt__team-name {
      font-size: 0.72rem;
    }

    .receipt__bucket-label {
      font-size: 0.9rem;
    }
  }

  @media (min-width: 1200px) {
    .receipt {
      max-width: min(80rem, 100%);
      padding: 1.75rem 2.25rem 1.35rem;
    }

    .receipt__grid {
      grid-template-columns: minmax(12rem, 1fr) minmax(22rem, 3fr) minmax(12rem, 1fr);
      gap: 0.875rem 1.25rem;
    }

    .receipt__bucket--2-1 .receipt__bucket-teams,
    .receipt__bucket--1-2 .receipt__bucket-teams {
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 0.35rem 0.85rem;
    }

    .receipt__team-name {
      font-size: 0.78rem;
    }
  }
</style>
