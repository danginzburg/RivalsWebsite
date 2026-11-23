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

<style src="./BatchPicker.css"></style>
