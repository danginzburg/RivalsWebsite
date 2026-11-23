<script lang="ts">
  /**
   * A team's standings rank at the end of each week. Rank 1 sits at the top,
   * so a line going up is a team climbing the table. Once the playoffs have
   * results, points carry the place the team has locked in the bracket instead
   * (drawn hollow, after a "Playoffs" divider).
   */
  type Point = {
    week_end: string
    rank: number
    of: number
    wins: number
    losses: number
    playoff?: { label: string; decided: boolean } | null
  }

  let { points }: { points: Point[] } = $props()

  const HEIGHT = 150
  const PAD = { top: 12, right: 14, bottom: 24, left: 30 }

  let width = $state(420)
  let active = $state<number | null>(null)

  const teamCount = $derived(Math.max(...points.map((p) => p.of), 2))
  const plotW = $derived(Math.max(width - PAD.left - PAD.right, 40))
  const plotH = HEIGHT - PAD.top - PAD.bottom

  const x = (i: number) =>
    PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW)
  const y = (rank: number) => PAD.top + ((rank - 1) / (teamCount - 1)) * plotH

  type Move = 'up' | 'down' | 'flat' | 'gold' | 'silver' | 'bronze'

  const PODIUM: Record<number, Move> = { 1: 'gold', 2: 'silver', 3: 'bronze' }

  /**
   * How the team moved into each week: green climbing, red dropping. A week
   * spent on the podium (1st–3rd) takes that place's medal colour instead.
   */
  const moves = $derived(
    points.map((p, i): Move => {
      if (PODIUM[p.rank]) return PODIUM[p.rank]
      if (i === 0) return 'flat'
      const diff = points[i - 1].rank - p.rank
      return diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'
    })
  )

  /** One segment per week, coloured by that week's move. */
  const segments = $derived(
    points.slice(1).map((p, i) => ({
      key: p.week_end,
      x1: x(i),
      y1: y(points[i].rank),
      x2: x(i + 1),
      y2: y(p.rank),
      move: moves[i + 1],
    }))
  )

  function moveLabel(i: number) {
    if (i === 0) return null
    const diff = points[i - 1].rank - points[i].rank
    if (diff === 0) return 'No change'
    const n = Math.abs(diff)
    return `${diff > 0 ? 'Up' : 'Down'} ${n} ${n === 1 ? 'place' : 'places'}`
  }

  /** Top, middle and bottom of the table — enough to read a rank by eye. */
  const yTicks = $derived(
    [...new Set([1, Math.round((teamCount + 1) / 2), teamCount])].filter((t) => t >= 1)
  )

  function shortDate(iso: string) {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  }

  /** First and last week always; the rest thinned so labels never collide. */
  const xLabels = $derived.by(() => {
    const room = Math.max(Math.floor(plotW / 64), 2)
    const step = Math.max(Math.ceil((points.length - 1) / (room - 1)), 1)
    return points
      .map((p, i) => ({ i, label: shortDate(p.week_end) }))
      .filter(
        ({ i }) =>
          i === 0 ||
          i === points.length - 1 ||
          (i % step === 0 && points.length - 1 - i >= step / 2)
      )
  })

  const slot = $derived(points.length > 1 ? plotW / (points.length - 1) : plotW)

  /** Index of the first playoff point, or -1. */
  const playoffStart = $derived(points.findIndex((p) => p.playoff))
  const dividerX = $derived(playoffStart <= 0 ? null : (x(playoffStart - 1) + x(playoffStart)) / 2)
  const tip = $derived(active === null ? null : points[active])
</script>

<div class="chart" bind:clientWidth={width}>
  <svg
    {width}
    height={HEIGHT}
    role="img"
    aria-label="Rank by week, from #{points[0]?.rank} to #{points.at(-1)?.rank} of {teamCount}"
  >
    {#each yTicks as tick (tick)}
      <line class="grid" x1={PAD.left} x2={PAD.left + plotW} y1={y(tick)} y2={y(tick)}></line>
      <text class="axis" x={PAD.left - 8} y={y(tick)} text-anchor="end" dominant-baseline="middle">
        #{tick}
      </text>
    {/each}

    {#each xLabels as { i, label } (i)}
      <text
        class="axis"
        x={x(i)}
        y={HEIGHT - 6}
        text-anchor={i === 0 && points.length > 1
          ? 'start'
          : i === points.length - 1 && points.length > 1
            ? 'end'
            : 'middle'}
      >
        {label}
      </text>
    {/each}

    {#if dividerX !== null}
      <line class="divider" x1={dividerX} x2={dividerX} y1={PAD.top} y2={PAD.top + plotH}></line>
      <text class="axis" x={dividerX + 4} y={PAD.top + plotH - 4}>Playoffs</text>
    {/if}

    {#if active !== null}
      <line class="cross" x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH}></line>
    {/if}

    {#each segments as seg (seg.key)}
      <line class="seg seg-{seg.move}" x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2}></line>
    {/each}

    {#each points as p, i (p.week_end)}
      <circle
        class="dot dot-{moves[i]}"
        class:dot-active={active === i}
        class:dot-playoff={Boolean(p.playoff)}
        cx={x(i)}
        cy={y(p.rank)}
        r={active === i ? 5 : 4}
      ></circle>
    {/each}

    {#each points as p, i (p.week_end)}
      <rect
        role="presentation"
        class="hit"
        x={x(i) - slot / 2}
        y={0}
        width={slot}
        height={HEIGHT}
        onpointerenter={() => (active = i)}
        onpointerleave={() => (active = null)}
      ></rect>
    {/each}
  </svg>

  {#if tip && active !== null}
    <div
      class="tip"
      class:tip-left={x(active) > width / 2}
      style="left: {x(active)}px; top: {y(tip.rank)}px"
    >
      <span class="tip-date">Week to {shortDate(tip.week_end)}</span>
      {#if tip.playoff}
        <span class="tip-rank">{tip.playoff.label}</span>
        <span class="tip-rec">Playoffs · {tip.of} teams</span>
      {:else}
        <span class="tip-rank">#{tip.rank} <span class="tip-of">of {tip.of}</span></span>
        <span class="tip-rec">{tip.wins}-{tip.losses} series</span>
      {/if}
      {#if moveLabel(active)}<span class="tip-rec">{moveLabel(active)}</span>{/if}
    </div>
  {/if}

  <table class="sr-only">
    <caption>Rank by week</caption>
    <thead><tr><th>Week ending</th><th>Rank</th><th>Series</th></tr></thead>
    <tbody>
      {#each points as p (p.week_end)}
        <tr>
          <td>{p.week_end}</td>
          <td>{p.playoff ? `Playoffs: ${p.playoff.label}` : `${p.rank} of ${p.of}`}</td>
          <td>{p.wins}-{p.losses}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style src="./RankHistoryChart.css"></style>
