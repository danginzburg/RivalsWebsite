<script lang="ts">
  type Column = { key: string; label: string }

  let {
    columns,
    visible = $bindable(),
    defaults,
    showRankSort = false,
    rankSort = $bindable(false),
    disregardTier = $bindable(false),
  }: {
    /** Every column the current batch can show, in table order. */
    columns: Column[]
    visible: string[]
    defaults: string[]
    showRankSort?: boolean
    rankSort?: boolean
    disregardTier?: boolean
  } = $props()

  /** Longer names in the menu where the table header is a single letter. */
  const MENU_LABELS: Record<string, string> = {
    games_won: 'Wins',
    games_lost: 'Losses',
    rounds_won: 'Rounds won',
    rounds_lost: 'Rounds lost',
    kills: 'Kills',
    deaths: 'Deaths',
    assists: 'Assists',
    clutches_won: 'Clutches won',
    clutches_attempted: 'Clutches played',
  }

  const GROUPS: Array<{ label: string; note?: string; wide?: boolean; keys: string[] }> = [
    {
      label: 'Results',
      keys: [
        'games',
        'games_won',
        'games_lost',
        'win_pct',
        'rounds',
        'rounds_won',
        'rounds_lost',
        'round_win_pct',
      ],
    },
    {
      label: 'Combat',
      keys: ['slr', 'acs', 'kd', 'kast_pct', 'adr', 'hs_pct', 'kills', 'deaths', 'assists'],
    },
    { label: 'Per game / round', keys: ['kpg', 'kpr', 'dpg', 'dpr', 'apg', 'apr'] },
    { label: 'Player', keys: ['agents'] },
    { label: 'Opening duels', keys: ['fk', 'fd', 'fkpg', 'fdpg'] },
    { label: 'Objectives', keys: ['plants', 'plants_per_game', 'defuses', 'defuses_per_game'] },
    {
      label: 'Multi-kills & clutches',
      note: 'Riot-imported matches only',
      wide: true,
      keys: [
        'mk_2k',
        'mk_3k',
        'mk_4k',
        'mk_5k',
        'mk_6k',
        'mk_7k',
        'clutches_won',
        'clutches_attempted',
        'clutch_win_pct',
      ],
    },
  ]

  const PRESETS: Array<{ id: string; label: string; keys: string[] | null }> = [
    { id: 'core', label: 'Core', keys: null },
    {
      id: 'combat',
      label: 'Combat',
      keys: [
        'slr',
        'agents',
        'games',
        'acs',
        'kd',
        'kast_pct',
        'adr',
        'hs_pct',
        'kills',
        'deaths',
        'assists',
        'kpr',
        'dpr',
      ],
    },
    {
      id: 'opening',
      label: 'Opening duels',
      keys: ['slr', 'agents', 'games', 'acs', 'kd', 'fk', 'fd', 'fkpg', 'fdpg'],
    },
    { id: 'all', label: 'All', keys: [] },
  ]

  const byKey = $derived(new Map(columns.map((c) => [c.key, c])))

  /** Groups trimmed to the columns this batch has (SLR is external-only). */
  const groups = $derived(
    GROUPS.map((g) => ({
      ...g,
      columns: g.keys.map((k) => byKey.get(k)).filter((c): c is Column => !!c),
    })).filter((g) => g.columns.length > 0)
  )
  const mainGroups = $derived(groups.filter((g) => !g.wide))
  const wideGroups = $derived(groups.filter((g) => g.wide))

  function presetKeys(preset: (typeof PRESETS)[number]): string[] {
    if (preset.keys === null) return defaults.filter((k) => byKey.has(k))
    if (preset.keys.length === 0) return columns.map((c) => c.key)
    return preset.keys.filter((k) => byKey.has(k))
  }

  const shownCount = $derived(columns.filter((c) => visible.includes(c.key)).length)

  const activePreset = $derived.by(() => {
    const current = new Set(visible.filter((k) => byKey.has(k)))
    for (const p of PRESETS) {
      const keys = presetKeys(p)
      if (keys.length === current.size && keys.every((k) => current.has(k))) return p.id
    }
    return null
  })

  function toggle(key: string) {
    visible = visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key]
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    visible = presetKeys(preset)
  }

  let open = $state(false)
  let root = $state<HTMLDivElement | null>(null)

  function onDocPointer(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false
  }

  function onKey(e: KeyboardEvent) {
    if (open && e.key === 'Escape') open = false
  }
</script>

<svelte:document onpointerdown={onDocPointer} onkeydown={onKey} />

<div class="columns-menu" bind:this={root}>
  <button
    type="button"
    class="columns-btn"
    class:columns-btn-open={open}
    aria-expanded={open}
    aria-haspopup="dialog"
    onclick={() => (open = !open)}
  >
    Columns <span class="columns-count">{shownCount}/{columns.length}</span>
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class:flip={open}><path d="m6 9 6 6 6-6"></path></svg
    >
  </button>

  {#if open}
    <div class="panel" role="dialog" aria-label="Columns">
      <div class="panel-head">
        <span class="panel-title">Columns</span>
        <span class="panel-note">{shownCount} of {columns.length} shown</span>
        <div class="presets" role="group" aria-label="Presets">
          {#each PRESETS as preset (preset.id)}
            <button
              type="button"
              class="preset"
              class:preset-on={activePreset === preset.id}
              aria-pressed={activePreset === preset.id}
              onclick={() => applyPreset(preset)}>{preset.label}</button
            >
          {/each}
          {#if activePreset === null}
            <span class="preset preset-custom">Custom</span>
          {/if}
        </div>
      </div>

      <div class="groups">
        {#each mainGroups as group (group.label)}
          <fieldset class="group">
            <legend class="group-label">{group.label}</legend>
            {#each group.columns as col (col.key)}
              <label class="check" class:check-off={!visible.includes(col.key)}>
                <input
                  type="checkbox"
                  checked={visible.includes(col.key)}
                  onchange={() => toggle(col.key)}
                />
                {MENU_LABELS[col.key] ?? col.label}
              </label>
            {/each}
          </fieldset>
        {/each}
        {#each wideGroups as group (group.label)}
          <fieldset class="group group-wide">
            <legend class="group-label">
              {group.label}
              {#if group.note}<span class="group-note">· {group.note}</span>{/if}
            </legend>
            <div class="wide-list">
              {#each group.columns as col (col.key)}
                <label class="check" class:check-off={!visible.includes(col.key)}>
                  <input
                    type="checkbox"
                    checked={visible.includes(col.key)}
                    onchange={() => toggle(col.key)}
                  />
                  {MENU_LABELS[col.key] ?? col.label}
                </label>
              {/each}
            </div>
          </fieldset>
        {/each}
      </div>

      <div class="panel-foot">
        {#if showRankSort}
          <span class="group-label">Rank sort</span>
          <label class="check" class:check-off={!rankSort}>
            <input type="checkbox" bind:checked={rankSort} />
            Sort by rank first
          </label>
          <label class="check" class:check-off={!disregardTier} class:check-disabled={!rankSort}>
            <input type="checkbox" bind:checked={disregardTier} disabled={!rankSort} />
            Ignore tier
          </label>
        {/if}
        <button type="button" class="reset" onclick={() => (visible = [...defaults])}>
          Reset to default
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .columns-menu {
    position: relative;
  }

  .columns-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    height: 2.25rem;
    padding: 0 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.88);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .columns-btn:hover {
    border-color: rgba(255, 255, 255, 0.24);
  }

  .columns-btn-open {
    border-color: rgba(192, 132, 252, 0.45);
    background: rgba(192, 132, 252, 0.1);
    color: #fff;
  }

  .columns-count {
    color: rgba(255, 255, 255, 0.5);
    font-variant-numeric: tabular-nums;
  }

  .flip {
    transform: rotate(180deg);
  }

  .panel {
    position: absolute;
    right: 0;
    top: calc(100% + 0.5rem);
    z-index: 30;
    width: min(45rem, calc(100vw - 2rem));
    max-height: min(36rem, calc(100dvh - 10rem));
    overflow-y: auto;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    padding: 1rem 1.125rem;
    border-radius: 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: #2a1647;
    box-shadow: 0 1.125rem 3rem rgba(8, 2, 20, 0.55);
  }

  .panel-head,
  .panel-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.625rem 1rem;
  }

  .panel-head {
    padding-bottom: 0.875rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .panel-foot {
    padding-top: 0.875rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .panel-title {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.82);
  }

  .panel-note {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin-left: auto;
  }

  .preset {
    height: 1.875rem;
    padding: 0 0.75rem;
    border-radius: 0.4375rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .preset:hover {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.24);
  }

  .preset-on,
  .preset-on:hover {
    color: #fff;
    border-color: rgba(192, 132, 252, 0.45);
    background: rgba(192, 132, 252, 0.1);
  }

  .preset-custom {
    display: inline-flex;
    align-items: center;
    cursor: default;
    border-style: dashed;
    color: rgba(255, 255, 255, 0.55);
  }

  .groups {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1rem 1.125rem;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }

  .group-wide {
    grid-column: 1 / -1;
  }

  .wide-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0 1.125rem;
  }

  .group-label {
    padding: 0;
    margin-bottom: 0.375rem;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
  }

  .panel-foot .group-label {
    margin-bottom: 0;
  }

  .group-note {
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
    color: rgba(255, 255, 255, 0.4);
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 1.75rem;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.82);
    cursor: pointer;
  }

  .check input {
    width: 0.9375rem;
    height: 0.9375rem;
    margin: 0;
    accent-color: #c084fc;
    cursor: pointer;
  }

  .check-off {
    color: rgba(255, 255, 255, 0.6);
  }

  .check-disabled {
    opacity: 0.5;
    cursor: default;
  }

  .reset {
    margin-left: auto;
    padding: 0;
    border: 0;
    background: none;
    color: rgba(255, 255, 255, 0.6);
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .reset:hover {
    color: #fff;
  }

  @media (max-width: 720px) {
    .groups {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .presets {
      margin-left: 0;
      width: 100%;
    }
  }

  @media (max-width: 640px) {
    .columns-btn {
      height: 2.75rem;
      font-size: 0.875rem;
    }

    /* On a phone the menu opens as a sheet pinned to the bottom of the screen. */
    .panel {
      position: fixed;
      left: 0.75rem;
      right: 0.75rem;
      top: auto;
      bottom: 0.75rem;
      width: auto;
      max-height: 75dvh;
    }

    .check {
      min-height: 2.25rem;
    }
  }
</style>
