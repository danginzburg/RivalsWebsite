<script lang="ts">
  import type { ComponentType } from 'svelte'

  type InfoItem = {
    icon: ComponentType
    title: string
    description: string
    href: string
  }

  let { items }: { items: InfoItem[] } = $props()
</script>

<div class="info-section-wrapper relative z-10">
  <div class="responsive-grid">
    {#each items as item}
      <div class="info-card info-card-surface">
        <div class="flex items-start gap-3">
          <span class="rounded-sm p-2" style="background-color: var(--accent); color: var(--text);">
            <svelte:component this={item.icon} class="h-5 w-5" />
          </span>
          <div class="flex-1">
            <a
              href={item.href}
              class="text-lg font-semibold hover:underline"
              style="color: var(--title);"
              target={item.href.startsWith('http') ? '_blank' : undefined}
              rel={item.href.startsWith('http') ? 'noopener noreferrer' : undefined}
            >
              {item.title}
            </a>
            <p class="text-sm" style="color: var(--text);">{item.description}</p>
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>
