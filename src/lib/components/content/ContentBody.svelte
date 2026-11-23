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

<style src="./ContentBody.css"></style>
