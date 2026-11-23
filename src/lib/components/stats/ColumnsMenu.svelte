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

<style src="./ColumnsMenu.css"></style>
