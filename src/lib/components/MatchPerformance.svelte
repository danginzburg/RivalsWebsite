<script lang="ts">
  import { displayPlayerName as displayName } from '$lib/stats/ui'

  /** One player's row for the selected scope (a single map, or the series). */
  export type PerfRow = {
    puuid: string | null
    player_name: string
    team_id: string | null
    kills?: number | null
    acs?: number | null
    fk?: number | null
    fd?: number | null
    mk_2k: number | null
    mk_3k: number | null
    mk_4k: number | null
    mk_5k: number | null
    mk_6k: number | null
    mk_7k: number | null
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
    teamALogo?: string | null
    teamBLogo?: string | null
  }

  let { rows, teamAId, teamAName, teamBName, teamALogo = null, teamBLogo = null }: Props = $props()

  /**
   * Sort players the same way the scoreboard table above does — kills desc,
   * then ACS desc, then name — so a given player sits in the same slot in both
   * places and the eye can track down the two tables without re-hunting.
   */
  function sortByKillsDesc(list: PerfRow[]): PerfRow[] {
    return [...list].sort((a, b) => {
      const killsA = Number.isFinite(Number(a.kills)) ? Number(a.kills) : 0
      const killsB = Number.isFinite(Number(b.kills)) ? Number(b.kills) : 0
      if (killsB !== killsA) return killsB - killsA

      const acsA = Number.isFinite(Number(a.acs)) ? Number(a.acs) : 0
      const acsB = Number.isFinite(Number(b.acs)) ? Number(b.acs) : 0
      if (acsB !== acsA) return acsB - acsA

      return displayName(a.player_name).localeCompare(displayName(b.player_name), undefined, {
        sensitivity: 'base',
      })
    })
  }

  const teamARows = $derived(sortByKillsDesc(rows.filter((r) => r.team_id === teamAId)))
  const teamBRows = $derived(sortByKillsDesc(rows.filter((r) => r.team_id !== teamAId)))

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

  /**
   * The whole row team's record against one column player. Read from the row
   * side like every other cell, so a colour means the same thing everywhere.
   */
  function columnTotals(col: PerfRow) {
    return teamARows.reduce(
      (acc, row) => {
        const d = duel(row, col)
        return {
          forKills: acc.forKills + d.forKills,
          againstKills: acc.againstKills + d.againstKills,
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

  /** First kills minus first deaths, or null when neither was recorded. */
  function entryDiff(r: PerfRow): number | null {
    if (r.fk == null && r.fd == null) return null
    return (r.fk ?? 0) - (r.fd ?? 0)
  }

  /** Sum of one count across a team; null when no player had it recorded. */
  function sumCount(list: PerfRow[], pick: (r: PerfRow) => number | null | undefined) {
    const present = list.map(pick).filter((v): v is number => v != null)
    return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null
  }

  /** A team's totals, shaped as a row so it renders through the same cells. */
  function teamTotal(list: PerfRow[]): PerfRow {
    const breakdowns = list.map((r) => r.clutch_breakdown).filter((b) => b !== null)
    let clutch_breakdown: PerfRow['clutch_breakdown'] = null
    if (breakdowns.length > 0) {
      clutch_breakdown = { won: {}, attempted: {} }
      for (const b of breakdowns) {
        for (const half of ['won', 'attempted'] as const) {
          for (const [size, count] of Object.entries(b[half] ?? {})) {
            clutch_breakdown[half][size] = (clutch_breakdown[half][size] ?? 0) + count
          }
        }
      }
    }
    return {
      puuid: null,
      player_name: 'Team total',
      team_id: list[0]?.team_id ?? null,
      fk: sumCount(list, (r) => r.fk),
      fd: sumCount(list, (r) => r.fd),
      mk_2k: sumCount(list, (r) => r.mk_2k),
      mk_3k: sumCount(list, (r) => r.mk_3k),
      mk_4k: sumCount(list, (r) => r.mk_4k),
      mk_5k: sumCount(list, (r) => r.mk_5k),
      mk_6k: sumCount(list, (r) => r.mk_6k),
      mk_7k: sumCount(list, (r) => r.mk_7k),
      clutches_won: sumCount(list, (r) => r.clutches_won),
      clutches_attempted: sumCount(list, (r) => r.clutches_attempted),
      clutch_breakdown,
      duels: null,
    }
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

  /** Largest one-on-one gap in the grid, so cell shading scales to this match. */
  const maxCellDiff = $derived(
    Math.max(
      0,
      ...teamARows.flatMap((row) => teamBRows.map((col) => Math.abs(duel(row, col).diff)))
    )
  )

  /** Same for the totals edge, which runs much larger than single cells. */
  const maxTotalDiff = $derived(
    Math.max(
      0,
      Math.abs(grandTotal.forKills - grandTotal.againstKills),
      ...teamARows.map((row) => {
        const t = duelTotals(row)
        return Math.abs(t.forKills - t.againstKills)
      }),
      ...teamBRows.map((col) => {
        const t = columnTotals(col)
        return Math.abs(t.forKills - t.againstKills)
      })
    )
  )

  /**
   * Shaded in the colour of whoever came out ahead — blue for the row team,
   * red for the column team — stronger the bigger the gap.
   */
  function heat(diff: number, max: number): string {
    if (diff === 0 || max === 0) return 'transparent'
    const alpha = (0.04 + 0.11 * Math.min(Math.abs(diff) / max, 1)).toFixed(2)
    return diff > 0 ? `rgba(96, 165, 250, ${alpha})` : `rgba(248, 113, 113, ${alpha})`
  }
</script>

{#snippet perfRow(row: PerfRow, isTotal: boolean)}
  {@const who = isTotal ? row.player_name : displayName(row.player_name)}
  <tr class:total-row={isTotal}>
    <td class="col-player">{who}</td>
    <td class="num">{fmt(row.fk ?? null)}</td>
    <td class="num">{fmt(row.fd ?? null)}</td>
    <td
      class="num"
      class:hot={(entryDiff(row) ?? 0) > 0}
      class:clutch-lost={(entryDiff(row) ?? 0) < 0}
    >
      {entryDiff(row) === null ? '—' : entryDiff(row)! > 0 ? `+${entryDiff(row)}` : entryDiff(row)}
    </td>
    <td class="num">{fmt(row.mk_2k)}</td>
    <td class="num" class:hot={(row.mk_3k ?? 0) > 0}>{fmt(row.mk_3k)}</td>
    <td class="num" class:hot={(row.mk_4k ?? 0) > 0}>{fmt(row.mk_4k)}</td>
    <td class="num" class:ace={(row.mk_5k ?? 0) > 0}>{fmt(row.mk_5k)}</td>
    <td class="num" class:ace={(row.mk_6k ?? 0) > 0}>{fmt(row.mk_6k)}</td>
    <td class="num" class:ace={(row.mk_7k ?? 0) > 0}>{fmt(row.mk_7k)}</td>
    {#each CLUTCH_SIZES as size (size)}
      {@const c = clutchAt(row, size)}
      <td
        class="num col-clutch"
        class:hot={(c?.won ?? 0) > 0}
        class:clutch-lost={c !== null && c.won === 0}
        title={c
          ? `${who} won ${c.won} of ${c.attempted} 1v${size} situations`
          : `${who} was never alone against ${size}`}
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
{/snippet}

{#snippet h2hCell(
  forKills: number,
  againstKills: number,
  max: number,
  title: string,
  total: boolean
)}
  {@const diff = forKills - againstKills}
  <td class="h2h-cell" class:h2h-total={total} style:background={heat(diff, max)} {title}>
    <span class="cell-score">{forKills}–{againstKills}</span>
    <span class="cell-diff" class:diff-up={diff > 0} class:diff-down={diff < 0}>
      {diff > 0 ? `+${diff}` : diff < 0 ? diff : '±0'}
    </span>
  </td>
{/snippet}

{#if hasData}
  <!-- Two sections of the match page's sheet: openings/multikills/clutches,
       then head to head. Both follow the page's map/total scope. -->
  <section class="sheet-section">
    <div class="sheet-head">
      <h2 class="sheet-title">Openings, Multikills &amp; Clutches</h2>
    </div>
    <div class="sheet-body sheet-pair">
      {#each [{ name: teamAName, logo: teamALogo, side: 'a', list: teamARows }, { name: teamBName, logo: teamBLogo, side: 'b', list: teamBRows }] as group (group.side)}
        <div class="perf-team">
          <div class="team-bar team-bar-{group.side}">
            {#if group.logo}<img src={group.logo} alt="" />{/if}
            <span class="team-bar-name">{group.name}</span>
          </div>
          <div class="table-scroll">
            <table class="perf-table">
              <thead>
                <tr>
                  <th class="col-player">Player</th>
                  <th title="First kills — opening kills of a round">FK</th>
                  <th title="First deaths — first to die in a round">FD</th>
                  <th title="First kills minus first deaths">+/−</th>
                  <th title="Rounds with exactly two kills">2K</th>
                  <th title="Rounds with exactly three kills">3K</th>
                  <th title="Rounds with exactly four kills">4K</th>
                  <th title="Aces">5K</th>
                  <th title="Rounds with exactly six kills (an opponent was revived)">6K</th>
                  <th title="Rounds with seven or more kills">7K</th>
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
                  {@render perfRow(row, false)}
                {/each}
                {#if group.list.length === 0}
                  <tr><td colspan="15" class="empty">No players recorded.</td></tr>
                {/if}
              </tbody>
              {#if group.list.length > 0}
                <tfoot>
                  {@render perfRow(teamTotal(group.list), true)}
                </tfoot>
              {/if}
            </table>
          </div>
        </div>
      {/each}
    </div>
  </section>

  {#if hasDuels}
    <section class="sheet-section">
      <div class="sheet-head">
        <h2 class="sheet-title">Head to Head</h2>
        <span class="sheet-note h2h-legend">
          <span class="legend-key"><i class="key key-a"></i>{teamAName} ahead</span>
          <span class="legend-key"><i class="key key-b"></i>{teamBName} ahead</span>
        </span>
      </div>
      <div class="sheet-body">
        <div class="table-scroll">
          <table class="h2h-table">
            <thead>
              <tr>
                <th class="h2h-corner">
                  <span class="corner-a">{teamAName} ↓</span>
                  <span class="corner-sep">·</span>
                  <span class="corner-b">{teamBName} →</span>
                </th>
                {#each teamBRows as col (col.player_name)}
                  <th class="h2h-head">{displayName(col.player_name)}</th>
                {/each}
                <th class="h2h-head h2h-total">Total</th>
              </tr>
            </thead>
            <tbody>
              {#each teamARows as row (row.player_name)}
                {@const t = duelTotals(row)}
                <tr>
                  <th class="h2h-side" scope="row">{displayName(row.player_name)}</th>
                  {#each teamBRows as col (col.player_name)}
                    {@const d = duel(row, col)}
                    {@render h2hCell(
                      d.forKills,
                      d.againstKills,
                      maxCellDiff,
                      `${displayName(row.player_name)} ${d.forKills} — ${d.againstKills} ${displayName(col.player_name)}`,
                      false
                    )}
                  {/each}
                  {@render h2hCell(
                    t.forKills,
                    t.againstKills,
                    maxTotalDiff,
                    `${displayName(row.player_name)} ${t.forKills} — ${t.againstKills} ${teamBName}`,
                    true
                  )}
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr class="h2h-foot">
                <th class="h2h-side" scope="row">Total</th>
                {#each teamBRows as col (col.player_name)}
                  {@const c = columnTotals(col)}
                  {@render h2hCell(
                    c.forKills,
                    c.againstKills,
                    maxTotalDiff,
                    `${teamAName} ${c.forKills} — ${c.againstKills} ${displayName(col.player_name)}`,
                    false
                  )}
                {/each}
                {@render h2hCell(
                  grandTotal.forKills,
                  grandTotal.againstKills,
                  maxTotalDiff,
                  'All kills traded between the two teams',
                  true
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
  {/if}
{/if}

<style src="./MatchPerformance.css"></style>
