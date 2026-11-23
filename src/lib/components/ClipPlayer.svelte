<script lang="ts">
  import { Play, ExternalLink } from 'lucide-svelte'
  import { parseClipUrl } from '$lib/media/clip-embed'

  interface Props {
    url: string
    title: string
  }

  let { url, title }: Props = $props()

  const embed = $derived(parseClipUrl(url))
  // The player only loads once asked for, so a page full of clips stays light.
  let playing = $state(false)
  let src = $state<string | null>(null)

  function play() {
    if (!embed) return
    src = embed.embedUrl(window.location.hostname)
    playing = true
  }
</script>

{#if embed}
  <div class="clip" class:clip-vertical={embed.isVertical}>
    {#if playing && src}
      <iframe
        {src}
        {title}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
    {:else}
      <button type="button" class="clip-poster" onclick={play} aria-label={`Play clip: ${title}`}>
        {#if embed.thumbnailUrl}
          <img src={embed.thumbnailUrl} alt="" loading="lazy" />
        {/if}
        <span class="clip-play"><Play size={20} fill="currentColor" /></span>
        <span class="clip-provider">{embed.providerLabel}</span>
      </button>
    {/if}
  </div>
{/if}

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
<a href={url} target="_blank" rel="noopener noreferrer" class="clip-link">
  {embed ? `Open on ${embed.providerLabel}` : 'Watch clip'}
  <ExternalLink size={12} />
</a>

<style src="./ClipPlayer.css"></style>
