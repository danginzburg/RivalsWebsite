<script lang="ts">
  import { externalEvents } from '$lib/stores/external-events.svelte'

  let { label = 'Show external events' }: { label?: string } = $props()
</script>

<!-- Site-wide: flipping it here flips it on every page. -->
<button
  type="button"
  class="ext-switch"
  class:ext-switch-on={externalEvents.show}
  aria-pressed={externalEvents.show}
  title="External events like Shitter League are hidden by default"
  onclick={() => externalEvents.toggle()}
>
  <span class="ext-track" aria-hidden="true"><span class="ext-knob"></span></span>
  {label}
</button>

<style src="./ExternalEventsToggle.css"></style>
