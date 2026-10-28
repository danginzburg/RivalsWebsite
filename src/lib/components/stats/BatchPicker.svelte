<script lang="ts">
  import { phaseLabel, resolveBatchSection, sectionOrder } from '$lib/stats/sections'

  type PickerBatch = {
    id: string
    event: string
    display_name?: string | null
    section?: string | null
    import_kind?: string | null
    week_label?: string | null
  }

  let {
    batches,
    events,
    batchId,
    onPick,
  }: {
    /** In server order (`sort_order` then recency), each tagged with its event. */
    batches: PickerBatch[]
    events: Array<{ name: string; external: boolean }>
    batchId: string | null
    onPick: (id: string) => void
  } = $props()

  /**
   * Two-step picker: an event (Season 4, Season 3, All Time…) then one of its
   * phases. One flat dropdown of every import was twenty-odd entries, most of
   * them the same five phase names repeated per season.
   *
   * A stable sort on section order keeps the server's order within each event.
   */

  /** Rivals seasons and outside events side by side but labelled apart. */
  const eventGroups = $derived(
    [
      { label: 'Rivals', external: false, items: events.filter((e) => !e.external) },
      { label: 'External', external: true, items: events.filter((e) => e.external) },
    ].filter((g) => g.items.length > 0)
  )

  function phasesOf(event: string) {
    return batches
      .map((b, index) => ({ b, index }))
      .filter(({ b }) => b.event === event)
      .sort(
        (a, z) =>
          sectionOrder(resolveBatchSection(a.b)) - sectionOrder(resolveBatchSection(z.b)) ||
          a.index - z.index
      )
      .map(({ b }) => ({ id: b.id, label: phaseLabel(b) }))
  }

  const activeEvent = $derived(
    batches.find((b) => b.id === batchId)?.event ?? events[0]?.name ?? null
  )
  const activePhases = $derived(activeEvent ? phasesOf(activeEvent) : [])

  function goToBatch(id: string) {
    if (id !== batchId) onPick(id)
  }

  /** Opening an event lands on its full-season total when there is one. */
  function goToEvent(event: string) {
    const full = batches.find((b) => b.event === event && resolveBatchSection(b) === 'full')
    const target = full?.id ?? phasesOf(event)[0]?.id
    if (target) goToBatch(target)
  }
</script>

{#if events.length > 0}
  <nav class="stats-nav" aria-label="Stats table">
    <div class="event-bar">
      {#each eventGroups as group (group.label)}
        <div
          class="event-group"
          class:event-group-external={group.external}
          role="tablist"
          aria-label="{group.label} events"
        >
          <span class="event-group-label">{group.label}</span>
          {#each group.items as event (event.name)}
            <button
              type="button"
              role="tab"
              class="nav-pill"
              class:nav-pill-external={event.external}
              class:nav-pill-on={event.name === activeEvent}
              aria-selected={event.name === activeEvent}
              onclick={() => goToEvent(event.name)}
            >
              {event.name}
            </button>
          {/each}
        </div>
      {/each}
    </div>
    {#if activePhases.length > 1}
      <div class="nav-row phase-row" role="tablist" aria-label="Phase">
        {#each activePhases as phase (phase.id)}
          <button
            type="button"
            role="tab"
            class="phase-tab"
            class:phase-tab-on={phase.id === batchId}
            aria-selected={phase.id === batchId}
            onclick={() => goToBatch(phase.id)}
          >
            {phase.label}
          </button>
        {/each}
      </div>
    {/if}
  </nav>
{/if}

<style>
  /* Event pills, then phase tabs underneath. */
  .stats-nav {
    /* layout.css shadows every <nav> for the site header; not this one. */
    box-shadow: none;
    align-self: flex-start;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .nav-row,
  .event-bar {
    display: flex;
    gap: 0.375rem;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .nav-row::-webkit-scrollbar,
  .event-bar::-webkit-scrollbar {
    display: none;
  }

  /* Only as wide as its pills; rivals seasons, then outside events after a
     divider. Still scrolls sideways when it outgrows the page. */
  .event-bar {
    align-self: flex-start;
    max-width: 100%;
    gap: 0.75rem;
    padding: 0.3125rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: var(--surface);
  }

  .event-group {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .event-group-external {
    padding-left: 0.75rem;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
  }

  .event-group-label {
    padding: 0 0.375rem 0 0.5rem;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
  }

  .event-group-external .event-group-label {
    color: rgba(251, 191, 36, 0.75);
  }

  .nav-pill {
    flex-shrink: 0;
    padding: 0.375rem 0.875rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.25);
    color: rgba(255, 255, 255, 0.62);
    font-size: 0.8125rem;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s,
      color 0.15s;
  }

  .nav-pill:hover {
    color: var(--text);
    border-color: rgba(255, 255, 255, 0.45);
  }

  .nav-pill-on,
  .nav-pill-on:hover {
    background: var(--accent);
    border-color: var(--hover);
    color: var(--text);
  }

  /* Outside events take amber instead of the site purple. */
  .nav-pill-external {
    border-color: rgba(251, 191, 36, 0.22);
  }

  .nav-pill-external.nav-pill-on,
  .nav-pill-external.nav-pill-on:hover {
    background: rgba(251, 191, 36, 0.18);
    border-color: rgba(251, 191, 36, 0.6);
    color: #fde68a;
  }

  .phase-row {
    align-self: flex-start;
    max-width: 100%;
    gap: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .phase-tab {
    flex-shrink: 0;
    padding: 0.375rem 0.75rem;
    margin-bottom: -1px;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: rgba(255, 255, 255, 0.55);
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition:
      color 0.15s,
      border-color 0.15s;
  }

  .phase-tab:hover {
    color: var(--text);
  }

  .phase-tab-on,
  .phase-tab-on:hover {
    color: var(--text);
    border-bottom-color: var(--hover);
  }
</style>
