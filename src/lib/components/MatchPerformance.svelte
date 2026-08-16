<script lang="ts">
  import { Swords, Crosshair } from 'lucide-svelte'
  import { displayPlayerName as displayName } from '$lib/stats/ui'

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
    clutch_breakdown: { won: Record<string, number>; attempted: Record<string, number> } | null
    duels: Record<string, number> | null
  }

  /** 1v1 through 1v5 — every clutch size gets a column, even if unused. */
  const CLUTCH_SIZES = [1, 2, 3, 4, 5] as const

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

  /** The column player's record against the whole opposing team. */
  function columnTotals(col: PerfRow) {
    return teamARows.reduce(
      (acc, row) => {
        const d = duel(row, col)
        // Flipped: from the column player's point of view, their kills are the
        // "against" half of the row player's duel.
        return {
          forKills: acc.forKills + d.againstKills,
          againstKills: acc.againstKills + d.forKills,
        }
      },
      { forKills: 0, againstKills: 0 }
    )
  }

  /** Every kill traded between the two teams, for the corner of the grid. */
  const grandTotal = $derived(
    teamARows.reduce(
      (acc, row) => {
        const t = duelTotals(row)
        return {
          forKills: acc.forKills + t.forKills,
          againstKills: acc.againstKills + t.againstKills,
        }
      },
      { forKills: 0, againstKills: 0 }
    )
  )

  /** "2 / 1 / 0" style breakdown, or a dash when nothing was recorded. */
  function fmt(value: number | null): string {
    return value === null ? '—' : String(value)
  }

  /**
   * One clutch size for one player. `attempted` of zero means the situation
   * never came up, which reads better as a dash than as "0/0".
   */
  function clutchAt(r: PerfRow, size: number) {
    const breakdown = r.clutch_breakdown
    if (!breakdown) return null
    const attempted = breakdown.attempted?.[String(size)] ?? 0
    if (attempted === 0) return null
    return { won: breakdown.won?.[String(size)] ?? 0, attempted }
  }
</script>

{#if hasData}
  <div class="perf">
    <!-- Multikills and clutches, one table per team -->
    <div class="perf-grid">
      {#each [{ name: teamAName, list: teamARows }, { name: teamBName, list: teamBRows }] as group (group.name)}
        <!-- No team heading: these sit directly under the scoreboard's own
             per-team tables and in the same left/right order, so repeating the
             name is noise. -->
        <section class="perf-card">
          <div class="table-scroll">
            <table class="perf-table">
              <thead>
                <tr>
                  <th class="col-player">Player</th>
                  <th title="Rounds with exactly two kills">2K</th>
                  <th title="Rounds with exactly three kills">3K</th>
                  <th title="Rounds with exactly four kills">4K</th>
                  <th title="Aces">5K</th>
                  {#each CLUTCH_SIZES as size (size)}
                    <th
                      class="col-clutch"
                      title="Clutches won of clutches attempted, alone against {size}"
                    >
                      1v{size}
                    </th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each group.list as row (row.player_name)}
                  <tr>
                    <td class="col-player">{displayName(row.player_name)}</td>
                    <td class="num">{fmt(row.mk_2k)}</td>
                    <td class="num" class:hot={(row.mk_3k ?? 0) > 0}>{fmt(row.mk_3k)}</td>
                    <td class="num" class:hot={(row.mk_4k ?? 0) > 0}>{fmt(row.mk_4k)}</td>
                    <td class="num" class:ace={(row.mk_5k ?? 0) > 0}>{fmt(row.mk_5k)}</td>
                    {#each CLUTCH_SIZES as size (size)}
                      {@const c = clutchAt(row, size)}
                      <td
                        class="num col-clutch"
                        class:hot={(c?.won ?? 0) > 0}
                        class:clutch-lost={c !== null && c.won === 0}
                        title={c
                          ? `${displayName(row.player_name)} won ${c.won} of ${c.attempted} 1v${size} situations`
                          : `${displayName(row.player_name)} was never alone against ${size}`}
                      >
                        {#if row.clutches_attempted === null}
                          —
                        {:else if c}
                          {c.won}/{c.attempted}
                        {:else}
                          <span class="clutch-none">·</span>
                        {/if}
                      </td>
                    {/each}
                  </tr>
                {/each}
                {#if group.list.length === 0}
                  <tr><td colspan="10" class="empty">No players recorded.</td></tr>
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
                  <th class="h2h-head">{displayName(col.player_name)}</th>
                {/each}
                <th class="h2h-head h2h-total">Total</th>
              </tr>
            </thead>
            <tbody>
              {#each teamARows as row (row.player_name)}
                <tr>
                  <th class="h2h-side">{displayName(row.player_name)}</th>
                  {#each teamBRows as col (col.player_name)}
                    {@const d = duel(row, col)}
                    <td
                      class="h2h-cell"
                      class:cell-up={d.diff > 0}
                      class:cell-down={d.diff < 0}
                      title="{displayName(
                        row.player_name
                      )} {d.forKills} — {d.againstKills} {displayName(col.player_name)}"
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
            <tfoot>
              <tr>
                <th class="h2h-side h2h-foot-label">Total</th>
                {#each teamBRows as col (col.player_name)}
                  {@const t = columnTotals(col)}
                  <td
                    class="h2h-cell h2h-foot"
                    class:cell-up={t.forKills > t.againstKills}
                    class:cell-down={t.forKills < t.againstKills}
                    title="{displayName(
                      col.player_name
                    )} {t.forKills} — {t.againstKills} {teamAName}"
                  >
                    <span class="cell-score">
                      <!-- Read from the column player's side, matching the header. -->
                      <span class="score-against">{t.forKills}</span><span class="score-sep">–</span
                      ><span class="score-for">{t.againstKills}</span>
                    </span>
                    <span class="cell-diff">
                      {t.forKills - t.againstKills > 0
                        ? `+${t.forKills - t.againstKills}`
                        : t.forKills - t.againstKills}
                    </span>
                  </td>
                {/each}
                <td
                  class="h2h-cell h2h-foot h2h-total"
                  class:cell-up={grandTotal.forKills > grandTotal.againstKills}
                  class:cell-down={grandTotal.forKills < grandTotal.againstKills}
                  title="All kills traded between the two teams"
                >
                  <span class="cell-score">
                    <span class="score-for">{grandTotal.forKills}</span><span class="score-sep"
                      >–</span
                    ><span class="score-against">{grandTotal.againstKills}</span>
                  </span>
                  <span class="cell-diff">
                    {grandTotal.forKills - grandTotal.againstKills > 0
                      ? `+${grandTotal.forKills - grandTotal.againstKills}`
                      : grandTotal.forKills - grandTotal.againstKills}
                  </span>
                </td>
              </tr>
            </tfoot>
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

  /*
   * Emphasis is carried by colour alone, not weight.
   *
   * These have to out-specify `.perf-table td`, which sets the base colour —
   * a bare `.hot` loses to it and silently renders plain white, which is why
   * bold was previously the only emphasis that showed.
   */
  .perf-table td.hot {
    color: #86efac;
  }

  .perf-table td.ace {
    color: #4ade80;
  }

  /* Clutch columns are narrow and numerous — keep them tight and even. */
  .col-clutch {
    min-width: 2.375rem;
  }

  /* Attempted but never won reads as a miss, not as an absence. */
  .perf-table td.clutch-lost {
    color: rgba(248, 113, 113, 0.85);
  }

  /* The situation never arose, which is different from losing it. */
  .clutch-none {
    color: rgba(255, 255, 255, 0.25);
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

  /* Column totals: same divider weight as the row-total column, so the grid
     reads as a block with a summary edge on two sides. */
  .h2h-foot {
    border-top: 1px solid rgba(255, 255, 255, 0.12);
  }

  .h2h-foot-label {
    border-top: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.62) !important;
    font-size: 0.5625rem !important;
    font-weight: 700 !important;
    text-transform: uppercase !important;
    letter-spacing: 0.06em !important;
  }

  @media (max-width: 860px) {
    .perf-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
