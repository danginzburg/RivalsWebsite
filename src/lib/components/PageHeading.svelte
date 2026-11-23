<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { ComponentType } from 'svelte'

  interface Props {
    title: string
    subtitle?: string
    icon?: ComponentType
    actions?: Snippet
  }

  let { title, subtitle, icon: Icon, actions }: Props = $props()
</script>

<div class="page-header">
  <div class="flex items-center gap-3">
    {#if Icon}
      <Icon size={32} style="color: var(--accent-text); flex-shrink: 0;" />
    {/if}
    <div class="min-w-0">
      <h1 class="heading-title">{title}</h1>
      {#if subtitle}
        <p class="heading-subtitle">{subtitle}</p>
      {/if}
    </div>
  </div>
  {#if actions}
    <div class="flex-shrink-0">
      {@render actions()}
    </div>
  {/if}
</div>

<style src="./PageHeading.css"></style>
