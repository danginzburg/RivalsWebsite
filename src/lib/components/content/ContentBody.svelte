<script lang="ts">
  import { parseContent, type InlineSegment } from '$lib/content/format'

  let { body, compact = false }: { body: string; compact?: boolean } = $props()

  const blocks = $derived(parseContent(body))
</script>

{#snippet inline(segments: InlineSegment[])}
  {#each segments as seg, i (i)}
    {#if seg.type === 'bold'}
      <strong>{seg.text}</strong>
    {:else if seg.type === 'italic'}
      <em>{seg.text}</em>
    {:else if seg.type === 'link'}
      <!-- Admin-authored URLs, which may be off-site. -->
      <!-- eslint-disable svelte/no-navigation-without-resolve -->
      <a
        href={seg.href}
        target={seg.external ? '_blank' : undefined}
        rel={seg.external ? 'noopener noreferrer' : undefined}>{seg.text}</a
      >
      <!-- eslint-enable svelte/no-navigation-without-resolve -->
    {:else}
      {seg.text}
    {/if}
  {/each}
{/snippet}

<div class="content-body" class:content-body-compact={compact}>
  {#each blocks as block, i (i)}
    {#if block.type === 'h'}
      <h4 class="cb-heading">{@render inline(block.inline)}</h4>
    {:else if block.type === 'ul' || block.type === 'ol'}
      <svelte:element this={block.type} class="cb-list cb-{block.type}">
        {#each block.items as item, j (j)}
          <li>{@render inline(item)}</li>
        {/each}
      </svelte:element>
    {:else if block.type === 'note'}
      <div class="cb-note">
        {#each block.lines as line, j (j)}
          {#if j > 0}<br />{/if}{@render inline(line)}
        {/each}
      </div>
    {:else if block.type === 'p'}
      <p class="cb-para">
        {#each block.lines as line, j (j)}
          {#if j > 0}{/if}{@render inline(line)}
        {/each}
      </p>
    {/if}
  {/each}
</div>

<style>
  .content-body {
    --cb-size: 0.9375rem;
    --cb-color: rgba(255, 255, 255, 0.75);
    max-width: 62ch;
  }

  .content-body-compact {
    --cb-size: 0.875rem;
    --cb-color: rgba(255, 255, 255, 0.65);
  }

  .cb-para,
  .cb-list li,
  .cb-note {
    font-size: var(--cb-size);
    line-height: 1.7;
    color: var(--cb-color);
  }

  .cb-para {
    margin-bottom: 0.875rem;
  }

  .cb-heading {
    margin: 1.25rem 0 0.5rem;
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--title);
  }

  .cb-heading:first-child {
    margin-top: 0;
  }

  .cb-list {
    margin: 0 0 0.875rem;
    padding: 0;
  }

  .cb-ul {
    list-style: none;
  }

  .cb-ul li {
    position: relative;
    padding-left: 1.25rem;
    margin-bottom: 0.375rem;
  }

  .cb-ul li::before {
    content: '';
    position: absolute;
    left: 0.25rem;
    top: 0.7em;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--hover);
  }

  .cb-ol {
    list-style: decimal;
    padding-left: 1.5rem;
  }

  .cb-ol li {
    margin-bottom: 0.375rem;
    padding-left: 0.25rem;
  }

  .cb-ol li::marker {
    color: var(--accent-text);
    font-weight: 700;
  }

  .cb-note {
    margin-bottom: 0.875rem;
    padding: 0.625rem 0.875rem;
    border-left: 3px solid var(--hover);
    border-radius: 0 0.5rem 0.5rem 0;
    background: rgba(120, 67, 145, 0.14);
    color: rgba(255, 255, 255, 0.85);
  }

  .content-body :global(strong) {
    color: var(--text);
    font-weight: 700;
  }

  .content-body :global(a) {
    color: var(--accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .content-body > :last-child {
    margin-bottom: 0;
  }
</style>
