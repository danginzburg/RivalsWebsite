<script lang="ts">
  import { Swords, Crosshair, Flame } from 'lucide-svelte'

  /** One player's row for the selected scope (a single map, or the series). */
  export type PerfRow = {
    puuid: string | null
    player_name: string
    team_id: string | null
    mk_2k: number | null
    mk_3k: number | null
    mk_4k: number | null
    mk_5k: number | null
    clutches_won: number | null
    clutches_attempted: number | null
    clutch_breakdown: Record<string, number> | null
    duels: Record<string, number> | null
  }

  interface Props {
    rows: PerfRow[]
    teamAId: string | null
    teamAName: string
    teamBName: string
    /** Label for what is being shown — "Series total" or a map name. */
    scopeLabel: string
  }

  let { rows, teamAId, teamAName, teamBName, scopeLabel }: Props = $props()

  const teamARows = $derived(rows.filter((r) => r.team_id === teamAId))
  const teamBRows = $derived(rows.filter((r) => r.team_id !== teamAId))

  /**
   * Advanced stats only exist for matches imported from the Riot API. A CSV
   * import has the columns but they are null, so the whole panel is hidden
   * rather than shown as a grid of dashes.
   */
  const hasData = $derived(
    rows.some((r) => r.mk_2k !== null || r.clutches_attempted !== null || r.duels !== null)
  )

  const hasDuels = $derived(
    teamARows.some((r) => r.puuid && r.duels) && teamBRows.some((r) => r.puuid)
  )

  /** Kills by `row` on `col`, and the reverse, read off each player's own row. */
  function duel(row: PerfRow, col: PerfRow) {
    const forKills = (row.duels && col.puuid ? row.duels[col.puuid] : 0) ?? 0
    const againstKills = (col.duels && row.puuid ? col.duels[row.puuid] : 0) ?? 0
    return { forKills, againstKills, diff: forKills - againstKills }
  }

  /**
   * A row's duel record against the whole opposing team. A function rather
   * than a `{@const}` in the markup: `{@const}` is only legal as a direct
   * child of a block tag, and this is needed inside a `<tr>`.
   */
  function duelTotals(row: PerfRow) {
    return teamBRows.reduce(
      (acc, col) => {
        const d = duel(row, col)
        return {
          forKills: acc.forKills + d.forKills,
          againstKills: acc.againstKills + d.againstKills,
        }
      },
      { forKills: 0, againstKills: 0 }
    )
  }

  /** "2 / 1 / 0" style breakdown, or a dash when nothing was recorded. */
  function fmt(value: number | null): string {
    return value === null ? '—' : String(value)
  }

  /** Clutch sizes that actually occurred, so an empty row stays quiet. */
  function clutchSizes(r: PerfRow): Array<{ size: string; count: number }> {
    if (!r.clutch_breakdown) return []
    return Object.entries(r.clutch_breakdown)
      .filter(([, count]) => count > 0)
      .map(([size, count]) => ({ size: `1v${size}`, count }))
      .sort((a, b) => a.size.localeCompare(b.size))
  }
</script>

{#if hasData}
  <div class="perf">
    <!-- Multikills and clutches, one table per team -->
    <div class="perf-grid">
      {#each [{ name: teamAName, list: teamARows }, { name: teamBName, list: teamBRows }] as group (group.name)}
        <section class="perf-card">
          <h3 class="perf-title"><Flame size={13} /> {group.name}</h3>
          <div class="table-scroll">
            <table class="perf-table">
              <thead>
                <tr>
                  <th class="col-player">Player</th>
                  <th title="Rounds with exactly two kills">2K</th>
                  <th title="Rounds with exactly three kills">3K</th>
                  <th title="Rounds with exactly four kills">4K</th>
                  <th title="Aces">5K</th>
                  <th title="Clutches won of clutches attempted">Clutch</th>
                </tr>
              </thead>
              <tbody>
                {#each group.list as row (row.player_name)}
                  <tr>
                    <td class="col-player">{row.player_name}</td>
                    <td class="num">{fmt(row.mk_2k)}</td>
                    <td class="num" class:hot={(row.mk_3k ?? 0) > 0}>{fmt(row.mk_3k)}</td>
                    <td class="num" class:hot={(row.mk_4k ?? 0) > 0}>{fmt(row.mk_4k)}</td>
                    <td class="num" class:ace={(row.mk_5k ?? 0) > 0}>{fmt(row.mk_5k)}</td>
                    <td class="num">
                      {#if row.clutches_attempted === null}
                        —
                      {:else}
                        <span class="clutch" class:hot={(row.clutches_won ?? 0) > 0}>
                          {row.clutches_won ?? 0}/{row.clutches_attempted}
                        </span>
                        {#if clutchSizes(row).length > 0}
                          <span class="clutch-sizes">
                            {clutchSizes(row)
                              .map((c) => (c.count > 1 ? `${c.size}×${c.count}` : c.size))
                              .join(' ')}
                          </span>
                        {/if}
                      {/if}
                    </td>
                  </tr>
                {/each}
                {#if group.list.length === 0}
                  <tr><td colspan="6" class="empty">No players recorded.</td></tr>
                {/if}
              </tbody>
            </table>
          </div>
        </section>
      {/each}
    </div>

    <!-- Head to head -->
    {#if hasDuels}
      <section class="perf-card">
        <h3 class="perf-title">
          <Swords size={13} /> Head to head
          <span class="perf-scope">{scopeLabel}</span>
        </h3>
        <p class="perf-legend">
          <Crosshair size={11} />
          Each cell reads <strong class="legend-row">row player's kills</strong> —
          <strong class="legend-col">column player's kills</strong>, with the difference from the
          row player's point of view.
        </p>

        <div class="table-scroll">
          <table class="h2h-table">
            <thead>
              <tr>
                <th class="h2h-corner">
                  <span class="corner-row">{teamAName} ↓</span>
                  <span class="corner-col">{teamBName} →</span>
                </th>
                {#each teamBRows as col (col.player_name)}
                  <th class="h2h-head">{col.player_name}</th>
                {/each}
                <th class="h2h-head h2h-total">Total</th>
              </tr>
            </thead>
            <tbody>
              {#each teamARows as row (row.player_name)}
                <tr>
                  <th class="h2h-side">{row.player_name}</th>
                  {#each teamBRows as col (col.player_name)}
                    {@const d = duel(row, col)}
                    <td
                      class="h2h-cell"
                      class:cell-up={d.diff > 0}
                      class:cell-down={d.diff < 0}
                      title="{row.player_name} {d.forKills} — {d.againstKills} {col.player_name}"
                    >
                      <span class="cell-score">
                        <span class="score-for">{d.forKills}</span><span class="score-sep">–</span
                        ><span class="score-against">{d.againstKills}</span>
                      </span>
                      <span class="cell-diff">
                        {d.diff > 0 ? `+${d.diff}` : d.diff < 0 ? d.diff : '±0'}
                      </span>
                    </td>
                  {/each}

                  <td
                    class="h2h-cell h2h-total"
                    class:cell-up={duelTotals(row).forKills > duelTotals(row).againstKills}
                    class:cell-down={duelTotals(row).forKills < duelTotals(row).againstKills}
                  >
                    <span class="cell-score">
                      <span class="score-for">{duelTotals(row).forKills}</span><span
                        class="score-sep">–</span
                      ><span class="score-against">{duelTotals(row).againstKills}</span>
                    </span>
                    <span class="cell-diff">
                      {duelTotals(row).forKills - duelTotals(row).againstKills > 0
                        ? `+${duelTotals(row).forKills - duelTotals(row).againstKills}`
                        : duelTotals(row).forKills - duelTotals(row).againstKills}
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
  </div>
{/if}

<style>
  .perf {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-top: 1rem;
  }

  .perf-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .perf-card {
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(0, 0, 0, 0.2);
    padding: 0.875rem;
    min-width: 0;
  }

  .perf-title {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.62);
    margin-bottom: 0.625rem;
  }

  .perf-scope {
    margin-left: auto;
    text-transform: none;
    letter-spacing: 0;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.45);
  }

  .perf-legend {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-wrap: wrap;
    font-size: 0.6875rem;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 0.75rem;
  }

  .legend-row {
    color: #93c5fd;
  }

  .legend-col {
    color: #fca5a5;
  }

  .table-scroll {
    overflow-x: auto;
  }

  .perf-table,
  .h2h-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.75rem;
  }

  .perf-table th,
  .h2h-table th {
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.5);
    padding: 0.25rem 0.375rem;
    text-align: right;
    white-space: nowrap;
  }

  .perf-table td {
    padding: 0.3125rem 0.375rem;
    text-align: right;
    color: rgba(255, 255, 255, 0.82);
    font-variant-numeric: tabular-nums;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .col-player {
    text-align: left !important;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .hot {
    color: #86efac;
    font-weight: 700;
  }

  .ace {
    color: #fbbf24;
    font-weight: 700;
  }

  .clutch-sizes {
    display: block;
    font-size: 0.5625rem;
    color: rgba(255, 255, 255, 0.45);
  }

  .empty {
    text-align: center !important;
    color: rgba(255, 255, 255, 0.45);
    padding: 1rem 0;
  }

  /* Head-to-head grid */
  .h2h-corner {
    text-align: left !important;
    line-height: 1.3;
  }

  .corner-row {
    display: block;
    color: #93c5fd;
  }

  .corner-col {
    display: block;
    color: #fca5a5;
  }

  .h2h-head {
    text-align: center !important;
    min-width: 4.5rem;
  }

  .h2h-side {
    text-align: left !important;
    font-size: 0.75rem !important;
    font-weight: 600 !important;
    text-transform: none !important;
    letter-spacing: 0 !important;
    color: var(--text) !important;
    white-space: nowrap;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .h2h-cell {
    text-align: center;
    padding: 0.3125rem 0.375rem;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    border-left: 1px solid rgba(255, 255, 255, 0.04);
    font-variant-numeric: tabular-nums;
    line-height: 1.25;
  }

  .cell-score {
    display: block;
    font-weight: 700;
    font-size: 0.75rem;
  }

  .score-for {
    color: #93c5fd;
  }

  .score-against {
    color: #fca5a5;
  }

  .score-sep {
    color: rgba(255, 255, 255, 0.3);
    margin: 0 0.0625rem;
  }

  .cell-diff {
    display: block;
    font-size: 0.5625rem;
    color: rgba(255, 255, 255, 0.4);
  }

  /* Tinted by who is ahead, so the grid reads at a glance. */
  .cell-up {
    background: rgba(74, 222, 128, 0.09);
  }

  .cell-down {
    background: rgba(248, 113, 113, 0.09);
  }

  .cell-up .cell-diff {
    color: #86efac;
  }

  .cell-down .cell-diff {
    color: #fca5a5;
  }

  .h2h-total {
    border-left: 1px solid rgba(255, 255, 255, 0.12);
  }

  @media (max-width: 860px) {
    .perf-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
