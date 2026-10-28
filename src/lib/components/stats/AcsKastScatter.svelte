<script lang="ts" module>
  export type ScatterPoint = {
    key: string
    name: string
    acs: number
    kast: number
    /** The signed-in player's own dot; only marked once they press Find me. */
    isViewer: boolean
    /** Full rank as assigned on the site ("Gold 2", "Immortal 120rr"). */
    rankLabel: string | null
    /** Rank group the dot is coloured by ("Gold"), null when unranked. */
    rankTier: string | null
  }

  /** Every division of a rank shares one colour: Gold 1–3 are all gold. */
  const RANK_COLORS: Record<string, string> = {
    Iron: '#8b8b8b',
    Bronze: '#b97a3d',
    Silver: '#d4dce3',
    Gold: '#eab308',
    Platinum: '#22b8cf',
    Diamond: '#d77bf3',
    Ascendant: '#34d399',
    Immortal: '#f43f5e',
    Radiant: '#fff4b8',
  }
  const RANK_TIERS = Object.keys(RANK_COLORS)
</script>

<script lang="ts">
  import { onMount } from 'svelte'
  import * as d3 from 'd3'

  let {
    points,
    highlightKey = null,
  }: {
    points: ScatterPoint[]
    /** The viewer's point, set only after they press Find me. */
    highlightKey?: string | null
  } = $props()

  /**
   * Only events whose ranks were recorded at the time offer rank colours.
   * Older seasons have none, and today's ranks would misrepresent them.
   */
  const hasRanks = $derived(points.some((p) => p.rankTier))
  let rankToggle = $state(false)
  const colorByRank = $derived(hasRanks && rankToggle)
  const highlighted = $derived(points.find((p) => p.key === highlightKey) ?? null)

  /** Legend entries for the ranks actually on the plot, low to high. */
  const legend = $derived.by(() => {
    const counts = d3.rollup(
      points,
      (group) => group.length,
      (p) => p.rankTier
    )
    const entries = RANK_TIERS.filter((t) => counts.has(t)).map((t) => ({
      tier: t,
      color: RANK_COLORS[t],
      count: counts.get(t) ?? 0,
    }))
    const unranked = counts.get(null) ?? 0
    return { entries, unranked }
  })

  function dotFill(p: ScatterPoint): string | null {
    if (!colorByRank) return null
    return p.rankTier ? (RANK_COLORS[p.rankTier] ?? null) : null
  }

  const MARGIN = { top: 16, right: 20, bottom: 44, left: 52 }
  const RADIUS = 4.5
  /** Screen-space distance that counts as "on" a point — also gathers stacked ones. */
  const HOVER_RADIUS = 9
  const MAX_ZOOM = 25

  let container: HTMLDivElement
  let svgEl: SVGSVGElement
  let width = $state(0)
  let height = $state(0)
  let transform = $state(d3.zoomIdentity)
  let hovered = $state<{ x: number; y: number; items: ScatterPoint[] } | null>(null)

  const innerW = $derived(Math.max(0, width - MARGIN.left - MARGIN.right))
  const innerH = $derived(Math.max(0, height - MARGIN.top - MARGIN.bottom))

  /** Padded domains so edge points are not clipped by the frame. */
  function paddedExtent(values: number[], pad: number): [number, number] {
    const [lo, hi] = d3.extent(values) as [number, number]
    if (lo === undefined) return [0, 1]
    const span = hi - lo || Math.abs(hi) || 1
    return [lo - span * pad, hi + span * pad]
  }

  const baseX = $derived(
    d3
      .scaleLinear()
      .domain(
        paddedExtent(
          points.map((p) => p.kast),
          0.06
        )
      )
      .range([0, innerW])
  )
  const baseY = $derived(
    d3
      .scaleLinear()
      .domain(
        paddedExtent(
          points.map((p) => p.acs),
          0.06
        )
      )
      .range([innerH, 0])
  )
  const x = $derived(transform.rescaleX(baseX))
  const y = $derived(transform.rescaleY(baseY))

  /**
   * Least-squares line of ACS on KAST, with r² so the strength of the trend is
   * readable at a glance. Null with fewer than two distinct KAST values.
   */
  const fit = $derived.by(() => {
    const n = points.length
    if (n < 2) return null
    const mx = d3.mean(points, (p) => p.kast)!
    const my = d3.mean(points, (p) => p.acs)!
    let sxy = 0
    let sxx = 0
    let syy = 0
    for (const p of points) {
      sxy += (p.kast - mx) * (p.acs - my)
      sxx += (p.kast - mx) ** 2
      syy += (p.acs - my) ** 2
    }
    if (sxx === 0) return null
    const slope = sxy / sxx
    return {
      slope,
      intercept: my - slope * mx,
      r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy),
    }
  })
  let showFit = $state(false)

  /** The fit drawn across whatever KAST range is in view. */
  const fitLine = $derived.by(() => {
    if (!fit) return null
    const [k0, k1] = x.domain()
    return {
      x1: x(k0),
      y1: y(fit.intercept + fit.slope * k0),
      x2: x(k1),
      y2: y(fit.intercept + fit.slope * k1),
    }
  })

  // The found point is drawn last so it is never buried under someone else's.
  const drawOrder = $derived(
    highlighted ? [...points.filter((p) => p !== highlighted), highlighted] : points
  )

  /**
   * Same-spot counts: tied stats render as one dot, so mark it with a ring
   * and the tooltip lists everyone under it.
   */
  const stackKey = (p: ScatterPoint) => `${p.kast.toFixed(1)}|${Math.round(p.acs)}`
  const stackCounts = $derived(d3.rollup(points, (group) => group.length, stackKey))

  let zoom: d3.ZoomBehavior<SVGSVGElement, unknown>

  onMount(() => {
    const ro = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width
      height = entry.contentRect.height
    })
    ro.observe(container)

    zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, MAX_ZOOM])
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        transform = event.transform
        hovered = null
      })
    d3.select(svgEl).call(zoom).on('dblclick.zoom', null)

    return () => ro.disconnect()
  })

  // Panning stays inside the plot; refreshed when the plot resizes.
  $effect(() => {
    if (!zoom || innerW <= 0 || innerH <= 0) return
    zoom
      .extent([
        [MARGIN.left, MARGIN.top],
        [MARGIN.left + innerW, MARGIN.top + innerH],
      ])
      .translateExtent([
        [0, 0],
        [innerW, innerH],
      ])
  })

  // New data (filters, a different season) starts zoomed out.
  $effect(() => {
    void points
    if (zoom && svgEl) d3.select(svgEl).call(zoom.transform, d3.zoomIdentity)
  })

  function resetZoom() {
    d3.select(svgEl).transition().duration(300).call(zoom.transform, d3.zoomIdentity)
  }

  // Find me: zoom in around the viewer's point so it stands out of the crowd.
  // Runs after the reset above, so it wins when both fire on the same update.
  $effect(() => {
    const target = highlighted
    if (!zoom || !svgEl || !target || innerW <= 0 || innerH <= 0) return
    const k = 3
    const t = d3.zoomIdentity
      .translate(innerW / 2, innerH / 2)
      .scale(k)
      .translate(-baseX(target.kast), -baseY(target.acs))
    d3.select(svgEl).transition().duration(500).call(zoom.transform, t)
  })

  let xAxisEl: SVGGElement
  let yAxisEl: SVGGElement
  let xGridEl: SVGGElement
  let yGridEl: SVGGElement

  $effect(() => {
    if (innerW <= 0 || innerH <= 0) return
    const xTicks = Math.max(2, Math.floor(innerW / 80))
    const yTicks = Math.max(2, Math.floor(innerH / 50))
    d3.select(xAxisEl).call(
      d3
        .axisBottom(x)
        .ticks(xTicks)
        .tickFormat((v) => `${v}%`)
    )
    d3.select(yAxisEl).call(d3.axisLeft(y).ticks(yTicks))
    d3.select(xGridEl).call(
      d3
        .axisBottom(x)
        .ticks(xTicks)
        .tickSize(-innerH)
        .tickFormat(() => '')
    )
    d3.select(yGridEl).call(
      d3
        .axisLeft(y)
        .ticks(yTicks)
        .tickSize(-innerW)
        .tickFormat(() => '')
    )
  })

  function handlePointerMove(event: PointerEvent) {
    const [mx, my] = d3.pointer(event, svgEl)
    const px = mx - MARGIN.left
    const py = my - MARGIN.top
    if (px < 0 || py < 0 || px > innerW || py > innerH) {
      hovered = null
      return
    }
    const near = points
      .map((p) => ({ p, d: Math.hypot(x(p.kast) - px, y(p.acs) - py) }))
      .filter((n) => n.d <= HOVER_RADIUS)
      .sort((a, b) => a.d - b.d)
      .map((n) => n.p)
    hovered = near.length > 0 ? { x: mx, y: my, items: near } : null
  }

  const tooltipItems = $derived(hovered ? hovered.items.slice(0, 8) : [])
  const tooltipLeft = $derived(hovered ? hovered.x > width * 0.6 : false)
  const tooltipUp = $derived(hovered ? hovered.y > height * 0.6 : false)
</script>

<div class="scatter">
  <div class="scatter-bar">
    <span class="scatter-title">ACS vs KAST</span>
    <span class="scatter-hint"
      >Scroll to zoom · drag to pan · double-click or reset to zoom out</span
    >
    <span class="bar-actions">
      {#if transform.k > 1}
        <button type="button" class="bar-btn" onclick={resetZoom}>
          Reset zoom ({transform.k.toFixed(1)}×)
        </button>
      {/if}
      <button
        type="button"
        class="bar-btn"
        class:bar-btn-on={showFit}
        aria-pressed={showFit}
        disabled={!fit}
        onclick={() => (showFit = !showFit)}
      >
        Line of best fit
      </button>
      {#if hasRanks}
        <button
          type="button"
          class="bar-btn"
          class:bar-btn-on={colorByRank}
          aria-pressed={colorByRank}
          onclick={() => (rankToggle = !rankToggle)}
        >
          Color by rank
        </button>
      {/if}
    </span>
  </div>

  {#if colorByRank}
    <div class="legend">
      {#each legend.entries as entry (entry.tier)}
        <span class="legend-item">
          <span class="legend-swatch" style:background={entry.color}></span>
          {entry.tier} <span class="legend-count">{entry.count}</span>
        </span>
      {/each}
      {#if legend.unranked > 0}
        <span class="legend-item">
          <span class="legend-swatch legend-swatch-none"></span>
          Unranked <span class="legend-count">{legend.unranked}</span>
        </span>
      {/if}
    </div>
  {/if}

  {#if showFit && fit}
    <div class="fit-caption">
      ACS ≈ {fit.slope.toFixed(2)} × KAST {fit.intercept < 0 ? '−' : '+'}
      {Math.abs(fit.intercept).toFixed(0)} · r² = {fit.r2.toFixed(2)}
    </div>
  {/if}

  <div class="scatter-plot" bind:this={container}>
    <svg
      bind:this={svgEl}
      {width}
      {height}
      onpointermove={handlePointerMove}
      onpointerleave={() => (hovered = null)}
      ondblclick={resetZoom}
      role="img"
      aria-label="Scatter plot of each player's ACS against KAST percentage"
    >
      <defs>
        <clipPath id="scatter-clip">
          <rect width={innerW} height={innerH}></rect>
        </clipPath>
      </defs>
      <g transform="translate({MARGIN.left},{MARGIN.top})">
        <g class="grid" bind:this={xGridEl} transform="translate(0,{innerH})"></g>
        <g class="grid" bind:this={yGridEl}></g>

        <g clip-path="url(#scatter-clip)">
          {#if showFit && fitLine}
            <line class="fit" {...fitLine}></line>
          {/if}
          {#each drawOrder as p (p.key)}
            <circle
              class="dot"
              class:dot-ranked={colorByRank}
              class:dot-unranked={colorByRank && !p.rankTier}
              class:dot-found={p === highlighted}
              class:dot-stacked={(stackCounts.get(stackKey(p)) ?? 1) > 1}
              class:dot-hovered={hovered?.items.includes(p)}
              style:fill={p === highlighted || hovered?.items.includes(p) ? null : dotFill(p)}
              cx={x(p.kast)}
              cy={y(p.acs)}
              r={p === highlighted ? RADIUS + 2 : RADIUS}
            ></circle>
          {/each}
          {#if highlighted}
            <circle
              class="found-ring"
              cx={x(highlighted.kast)}
              cy={y(highlighted.acs)}
              r={RADIUS + 8}
            ></circle>
            <text
              class="found-label"
              x={x(highlighted.kast)}
              y={y(highlighted.acs) - RADIUS - 12}
              text-anchor="middle">{highlighted.name}</text
            >
          {/if}
        </g>

        <g class="axis" bind:this={xAxisEl} transform="translate(0,{innerH})"></g>
        <g class="axis" bind:this={yAxisEl}></g>

        <text class="axis-label" x={innerW / 2} y={innerH + 36} text-anchor="middle">KAST %</text>
        <text
          class="axis-label"
          transform="translate({-40},{innerH / 2}) rotate(-90)"
          text-anchor="middle">ACS</text
        >
      </g>
    </svg>

    {#if hovered}
      <div
        class="tooltip"
        class:tooltip-left={tooltipLeft}
        class:tooltip-up={tooltipUp}
        style="left: {hovered.x}px; top: {hovered.y}px"
      >
        {#if hovered.items.length > 1}
          <div class="tooltip-head">{hovered.items.length} players here</div>
        {/if}
        {#each tooltipItems as p (p.key)}
          <div class="tooltip-row">
            <span class="tooltip-name" class:tooltip-mine={p === highlighted}>{p.name}</span>
            {#if p.rankLabel}
              <span class="tooltip-rank" style:color={p.rankTier ? RANK_COLORS[p.rankTier] : null}
                >{p.rankLabel}</span
              >
            {/if}
            <span class="tooltip-stats">
              <span>ACS <b>{p.acs.toFixed(0)}</b></span>
              <span>KAST <b>{p.kast.toFixed(1)}%</b></span>
            </span>
          </div>
        {/each}
        {#if hovered.items.length > tooltipItems.length}
          <div class="tooltip-more">
            +{hovered.items.length - tooltipItems.length} more — zoom in
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .scatter {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: var(--surface);
  }

  .scatter-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.625rem 0.875rem 0;
  }

  .scatter-title {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.8);
  }

  .scatter-hint {
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .bar-actions {
    display: flex;
    gap: 0.375rem;
    margin-left: auto;
  }

  .bar-btn {
    padding: 0.25rem 0.625rem;
    border-radius: 0.375rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(0, 0, 0, 0.25);
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.6875rem;
    font-weight: 600;
    cursor: pointer;
  }

  .bar-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .bar-btn:hover {
    color: var(--text);
    border-color: rgba(255, 255, 255, 0.45);
  }

  .bar-btn-on,
  .bar-btn-on:hover {
    background: var(--accent);
    border-color: var(--hover);
    color: var(--text);
  }

  .fit-caption {
    padding: 0.375rem 0.875rem 0;
    font-size: 0.6875rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.75);
    font-variant-numeric: tabular-nums;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem 0.875rem;
    padding: 0.5rem 0.875rem 0;
    font-size: 0.6875rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.75);
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
  }

  .legend-swatch {
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 999px;
  }

  .legend-swatch-none {
    border: 1px dashed rgba(255, 255, 255, 0.5);
  }

  .legend-count {
    color: rgba(255, 255, 255, 0.45);
    font-variant-numeric: tabular-nums;
  }

  .scatter-plot {
    position: relative;
    flex: 1 1 0;
    min-height: 16rem;
    overflow: hidden;
  }

  svg {
    position: absolute;
    inset: 0;
    display: block;
    cursor: grab;
    touch-action: none;
  }

  svg:active {
    cursor: grabbing;
  }

  .grid :global(line) {
    stroke: rgba(255, 255, 255, 0.06);
  }

  .grid :global(.domain) {
    display: none;
  }

  .axis :global(.domain),
  .axis :global(line) {
    stroke: rgba(255, 255, 255, 0.25);
  }

  .axis :global(text) {
    fill: rgba(255, 255, 255, 0.62);
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
  }

  .axis-label {
    fill: rgba(255, 255, 255, 0.7);
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.07em;
  }

  /* White so it reads over both the purple and the rank colours. */
  .fit {
    stroke: rgba(255, 255, 255, 0.85);
    stroke-width: 2;
    stroke-linecap: round;
    pointer-events: none;
  }

  /* Translucent fill: where points pile up the colour visibly deepens. */
  .dot {
    fill: rgba(192, 132, 252, 0.55);
    stroke: #e9d5ff;
    stroke-width: 1;
    stroke-opacity: 0.7;
    transition: r 0.1s;
  }

  /* Rank colours come in as an inline fill; a dark edge keeps light ones apart. */
  .dot-ranked {
    fill-opacity: 0.85;
    stroke: rgba(0, 0, 0, 0.55);
    stroke-opacity: 1;
  }

  .dot-unranked {
    fill: transparent;
    stroke: rgba(255, 255, 255, 0.55);
    stroke-dasharray: 2 2;
  }

  /* Several players on one exact spot get a white ring. */
  .dot-stacked {
    stroke: #fff;
    stroke-width: 2;
    stroke-opacity: 1;
    stroke-dasharray: none;
  }

  .dot-found {
    fill: #4ade80;
    stroke: #bbf7d0;
    stroke-width: 2;
  }

  .dot-hovered {
    fill: #fff;
    stroke: var(--accent-text);
    stroke-width: 2;
  }

  .found-ring {
    fill: none;
    stroke: #4ade80;
    stroke-width: 2;
    animation: found-pulse 1.4s ease-out infinite;
    pointer-events: none;
  }

  @keyframes found-pulse {
    from {
      stroke-opacity: 0.9;
    }
    to {
      stroke-opacity: 0.1;
    }
  }

  .found-label {
    fill: #bbf7d0;
    font-size: 0.75rem;
    font-weight: 700;
    paint-order: stroke;
    stroke: rgba(20, 10, 36, 0.9);
    stroke-width: 3px;
    pointer-events: none;
  }

  .tooltip {
    position: absolute;
    z-index: 10;
    transform: translate(12px, 12px);
    pointer-events: none;
    min-width: 10rem;
    max-width: 16rem;
    padding: 0.5rem 0.625rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(20, 10, 36, 0.96);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
    font-size: 0.75rem;
  }

  .tooltip-left {
    transform: translate(calc(-100% - 12px), 12px);
  }

  .tooltip-up {
    transform: translate(12px, calc(-100% - 12px));
  }

  .tooltip-left.tooltip-up {
    transform: translate(calc(-100% - 12px), calc(-100% - 12px));
  }

  .tooltip-head {
    margin-bottom: 0.375rem;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #fde68a;
  }

  .tooltip-row + .tooltip-row {
    margin-top: 0.375rem;
    padding-top: 0.375rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .tooltip-name {
    display: block;
    font-weight: 700;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tooltip-mine {
    color: #86efac;
  }

  .tooltip-rank {
    display: block;
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .tooltip-stats {
    display: flex;
    gap: 0.75rem;
    color: rgba(255, 255, 255, 0.62);
    font-variant-numeric: tabular-nums;
  }

  .tooltip-stats b {
    color: var(--text);
    font-weight: 600;
  }

  .tooltip-more {
    margin-top: 0.375rem;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.5);
  }
</style>
