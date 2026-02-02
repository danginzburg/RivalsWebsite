<script>
  import PageContainer from '$lib/components/PageContainer.svelte'
  import ContentSection from '$lib/components/ContentSection.svelte'

  const rulebookUrl =
    'https://docs.google.com/document/d/1IckzrbvNamc-Suq3kgBCm-Umd_W_zpMFWiiHWg8dMTg/preview'
</script>

<div
  class="fixed inset-0 flex flex-col pt-16"
  style="background-color: var(--secondary-background);"
>
  <div class="flex-shrink-0 px-8 py-6">
    <h1 class="responsive-title text-center">Rulebook</h1>
  </div>
  <div class="flex-1 overflow-hidden px-8 pb-8">
    <div class="mx-auto h-full w-full max-w-4xl">
      <iframe
        src={rulebookUrl}
        title="Throw City Rivals Rulebook"
        class="h-full w-full rounded-md border border-white/10"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        allowfullscreen
      ></iframe>
    </div>
  </div>
</div>
