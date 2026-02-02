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
    class="h-auto min-h-[30vh] w-[95%] rounded-lg object-cover sm:min-h-[40vh] sm:w-[90%] md:min-h-[50vh] md:w-[85%]"
    style="filter: saturate(0.6) blur(2px) brightness(0.7);"
  />
  <div
    class="absolute flex w-[80%] flex-col items-center justify-center rounded-lg px-6 py-6 sm:w-[75%] sm:px-10 sm:py-8 md:w-[70%] md:px-12 md:py-10"
    style="background: rgba(9, 6, 9, 0.4); color: var(--text); max-width: 700px;"
  >
    <h1 class="responsive-title w-full text-center break-words sm:mb-4 md:mb-6">
      {title}
    </h1>
    {#if subtitle}
      <h2 class="responsive-subtitle hidden w-full text-center break-words sm:block">
        {subtitle}
      </h2>
    {/if}
    {#if description}
      <p class="responsive-text hidden w-full max-w-2xl text-center break-words sm:block">
        {description}
      </p>
    {/if}
  </div>
</div>
