<script lang="ts">
  interface Props {
    image: string
    imageAlt?: string
    title: string
    subtitle?: string
    description?: string
    class?: string
  }

  let {
    image,
    imageAlt = 'Hero Background',
    title,
    subtitle = '',
    description = '',
    class: className = '',
  }: Props = $props()
</script>

<div class="content-section-hero {className}">
  <img
    src={image}
    alt={imageAlt}
    class="h-auto w-full"
    style="filter: saturate(0.6) blur(2px) brightness(0.7);"
  />
  <div
    class="absolute flex flex-col items-center justify-center rounded-lg px-4 py-3 sm:px-6 sm:py-4 md:px-8 md:py-6"
    style="background: rgba(9, 6, 9, 0.4); color: var(--text);"
  >
    <h1 class="responsive-title mb-2 text-center sm:mb-4 md:mb-6">
      {title}
    </h1>
    {#if subtitle}
      <h2 class="responsive-subtitle text-center">
        {subtitle}
      </h2>
    {/if}
    {#if description}
      <p class="responsive-text max-w-2xl text-center">
        {description}
      </p>
    {/if}
  </div>
</div>
