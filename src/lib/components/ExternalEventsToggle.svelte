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

<style>
  .ext-switch {
    display: inline-flex;
    align-items: center;
    gap: 0.625rem;
    min-height: 2.75rem;
    padding: 0 0.125rem;
    background: none;
    border: 0;
    font: inherit;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.82);
    cursor: pointer;
    white-space: nowrap;
  }

  .ext-switch:hover {
    color: #fff;
  }

  .ext-track {
    position: relative;
    width: 1.875rem;
    height: 1.125rem;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.14);
    flex-shrink: 0;
    transition: background 0.15s;
  }

  .ext-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 0.875rem;
    height: 0.875rem;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.8);
    transition: transform 0.15s;
  }

  .ext-switch-on .ext-track {
    background: rgba(192, 132, 252, 0.5);
  }

  .ext-switch-on .ext-knob {
    transform: translateX(12px);
    background: #fff;
  }
</style>
