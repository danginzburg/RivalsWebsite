<script lang="ts">
  import CustomSelect from '$lib/components/CustomSelect.svelte'
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
   * Two joined selects: an event (Season 4, Season 3, All Time…) then one of
   * its phases. One flat dropdown of every import was twenty-odd entries, most
   * of them the same five phase names repeated per season.
   *
   * A stable sort on section order keeps the server's order within each event.
   */

  /** Rivals seasons and outside events side by side but labelled apart. */
  const eventOptions = $derived([
    ...events
      .filter((e) => !e.external)
      .map((e) => ({ value: e.name, label: e.name, group: 'Rivals' })),
    ...events
      .filter((e) => e.external)
      .map((e) => ({ value: e.name, label: e.name, group: 'External' })),
  ])

  function phasesOf(event: string) {
    return batches
      .map((b, index) => ({ b, index }))
      .filter(({ b }) => b.event === event)
      .sort(
        (a, z) =>
          sectionOrder(resolveBatchSection(a.b)) - sectionOrder(resolveBatchSection(z.b)) ||
          a.index - z.index
      )
      .map(({ b }) => ({ value: b.id, label: phaseLabel(b) }))
  }

  const activeEvent = $derived(
    batches.find((b) => b.id === batchId)?.event ?? events[0]?.name ?? null
  )
  const activePhases = $derived(activeEvent ? phasesOf(activeEvent) : [])

  function goToBatch(id: string) {
    if (id && id !== batchId) onPick(id)
  }

  /** Opening an event lands on its full-season total when there is one. */
  function goToEvent(event: string) {
    const full = batches.find((b) => b.event === event && resolveBatchSection(b) === 'full')
    const target = full?.id ?? phasesOf(event)[0]?.value
    if (target) goToBatch(target)
  }
</script>

{#if events.length > 0}
  <div class="batch-picker" class:batch-picker-single={activePhases.length <= 1}>
    <div class="picker-slot picker-event" aria-label="Event" role="group">
      <CustomSelect
        options={eventOptions}
        value={activeEvent ?? ''}
        placeholder="Event"
        onSelect={goToEvent}
      />
    </div>
    {#if activePhases.length > 1}
      <div class="picker-slot picker-phase" aria-label="Phase" role="group">
        <CustomSelect
          options={activePhases}
          value={batchId ?? ''}
          placeholder="Phase"
          onSelect={goToBatch}
        />
      </div>
    {/if}
  </div>
{/if}

<style>
  .batch-picker {
    display: flex;
    min-width: 0;
  }

  .picker-event {
    width: 9.5rem;
  }

  .picker-phase {
    width: 11rem;
  }

  /* CustomSelect, tuned to the sheet: same height and fill as the other
     toolbar controls, the two triggers joined into one control. */
  .picker-slot :global(.select-trigger) {
    height: 2.25rem;
    padding: 0 0.625rem 0 0.75rem;
    gap: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.88);
    font: inherit;
    font-size: 0.8125rem;
  }

  .picker-slot :global(.select-trigger:hover) {
    border-color: rgba(255, 255, 255, 0.24);
  }

  .picker-slot :global(.select-trigger:focus-visible),
  .picker-slot :global(.select-trigger[aria-expanded='true']) {
    border-color: rgba(192, 132, 252, 0.45);
    box-shadow: none;
    position: relative;
    z-index: 1;
  }

  .picker-slot :global(.chevron),
  .picker-slot :global(.chevron svg) {
    width: 0.75rem;
    height: 0.75rem;
  }

  .batch-picker:not(.batch-picker-single) .picker-event :global(.select-trigger) {
    border-radius: 0.5rem 0 0 0.5rem;
  }

  .picker-phase :global(.select-trigger) {
    margin-left: -1px;
    border-radius: 0 0.5rem 0.5rem 0;
  }

  /* The open list matches the Columns menu panel. */
  .picker-slot :global(.select-dropdown) {
    min-width: 11rem;
    max-height: min(22rem, calc(100dvh - 8rem)) !important;
    padding: 0.3125rem;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 0.625rem;
    background: #2a1647;
    box-shadow: 0 1.125rem 3rem rgba(8, 2, 20, 0.55);
  }

  .picker-slot :global(.select-dropdown li) {
    padding: 0.4375rem 0.625rem;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.82);
    border-radius: 0.375rem;
  }

  .picker-slot :global(.select-dropdown li:hover),
  .picker-slot :global(.select-dropdown li:focus) {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
  }

  .picker-slot :global(.select-dropdown li.selected) {
    background: rgba(192, 132, 252, 0.14);
    color: #fff;
  }

  .picker-slot :global(.select-dropdown li.group-header),
  .picker-slot :global(.select-dropdown li.group-header:hover) {
    padding: 0.5rem 0.625rem 0.25rem;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    background: transparent;
    color: rgba(255, 255, 255, 0.45);
  }

  @media (max-width: 640px) {
    .batch-picker {
      width: 100%;
    }

    .picker-slot {
      flex: 1 1 0;
      min-width: 0;
      width: auto;
    }

    .picker-slot :global(.select-trigger) {
      height: 2.75rem;
      font-size: 0.875rem;
    }

    .picker-slot :global(.select-dropdown li) {
      padding: 0.625rem;
      font-size: 0.875rem;
    }
  }
</style>
