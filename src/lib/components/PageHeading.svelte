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
      <Icon size={32} style="color: var(--text); flex-shrink: 0;" />
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

<style>
  .heading-title {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--title);
    line-height: 1.2;
  }

  .heading-subtitle {
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.6);
    margin-top: 0.125rem;
  }

  @media (max-width: 640px) {
    .heading-title {
      font-size: 1.375rem;
    }

    .heading-subtitle {
      font-size: 0.8125rem;
    }
  }
</style>
