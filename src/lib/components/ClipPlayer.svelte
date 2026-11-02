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

<style>
  .clip {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    margin-top: 0.75rem;
    border-radius: 0.5rem;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.45);
  }

  .clip-vertical {
    max-width: 16rem;
    aspect-ratio: 9 / 16;
    margin-inline: auto;
  }

  .clip iframe,
  .clip-poster {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }

  .clip-poster {
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: linear-gradient(135deg, rgba(251, 146, 60, 0.18), rgba(0, 0, 0, 0.5));
  }

  .clip-poster img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.85;
    transition: opacity 0.15s;
  }

  .clip-poster:hover img {
    opacity: 1;
  }

  .clip-play {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    border-radius: 999px;
    color: #fff;
    background: rgba(251, 146, 60, 0.9);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
    transition: transform 0.15s;
  }

  .clip-poster:hover .clip-play {
    transform: scale(1.08);
  }

  .clip-provider {
    position: absolute;
    left: 0.5rem;
    bottom: 0.5rem;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #fff;
    background: rgba(0, 0, 0, 0.6);
  }

  .clip-link {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    margin-top: 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: #fb923c;
    text-decoration: none;
  }

  .clip-link:hover {
    text-decoration: underline;
  }
</style>
