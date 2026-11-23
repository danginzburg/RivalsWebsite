<script lang="ts">
  import { page } from '$app/state'
  import siteLogo from '$lib/assets/rivals_logo.webp'
  import { DEFAULT_DESCRIPTION, SITE_NAME, STATIC_PAGE_META, type PageMeta } from '$lib/meta'

  /**
   * Open Graph tags for link previews (Discord, iMessage, Slack…), from the
   * page's `meta` or the site defaults. Rendered once, in the root layout, so
   * a page never ends up with two sets of tags.
   */
  const meta = $derived(
    (page.data.meta as PageMeta | undefined) ?? STATIC_PAGE_META[page.url.pathname]
  )

  function absolute(src: string): string {
    return /^https?:\/\//i.test(src) ? src : new URL(src, page.url.origin).href
  }

  const title = $derived(meta?.title ?? SITE_NAME)
  const description = $derived(meta?.description || DEFAULT_DESCRIPTION)
  const image = $derived(absolute(meta?.image || siteLogo))
  const url = $derived(page.url.origin + page.url.pathname + page.url.search)
</script>

<svelte:head>
  <meta name="description" content={description} />
  <meta property="og:site_name" content={SITE_NAME} />
  <meta property="og:type" content={meta?.type ?? 'website'} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={url} />
  <meta property="og:image" content={image} />
  {#if meta?.largeImage}
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
  {/if}
  <!-- summary_large_image is what makes Discord show the card full width. -->
  <meta name="twitter:card" content={meta?.largeImage ? 'summary_large_image' : 'summary'} />
  <!-- Colours the stripe down the side of a Discord embed. -->
  <meta name="theme-color" content="#c084fc" />
</svelte:head>
