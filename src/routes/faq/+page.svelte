<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import ContentBody from '$lib/components/content/ContentBody.svelte'
  import { HelpCircle, ChevronRight } from 'lucide-svelte'
  import { contentPlainText } from '$lib/content/format'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  /** Hidden categories and questions are drafts: kept in the editor, never shown here. */
  const categories = $derived(
    data.faq.categories
      .filter((c) => !c.hidden)
      .map((c) => ({ ...c, entries: c.entries.filter((e) => !e.hidden) }))
      .filter((c) => c.entries.length > 0)
  )

  let openKey = $state<string | null>(null)
  let search = $state('')

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase()
    if (!q) return categories

    return categories
      .map((group) => ({
        ...group,
        entries: group.entries.filter(
          (e) =>
            e.question.toLowerCase().includes(q) ||
            contentPlainText(e.answer).toLowerCase().includes(q)
        ),
      }))
      .filter((group) => group.entries.length > 0)
  })

  function toggle(key: string) {
    openKey = openKey === key ? null : key
  }
</script>

<svelte:head><title>FAQ</title></svelte:head>

<PageContainer>
  <div class="page-content-narrow py-6">
    <PageHeading
      title="Frequently Asked Questions"
      subtitle="Answers to the questions we get most often."
      icon={HelpCircle}
    />

    {#if data.faq.intro.trim()}
      <div class="faq-intro"><ContentBody body={data.faq.intro} /></div>
    {/if}

    <input bind:value={search} class="faq-search" placeholder="Search questions..." />

    {#if categories.length === 0}
      <div class="no-results">No questions have been published yet.</div>
    {:else if filtered.length === 0}
      <div class="no-results">No questions match "{search}".</div>
    {:else}
      {#each filtered as group (group.key)}
        <section class="faq-group">
          <h2 class="faq-category">{group.title}</h2>
          <div class="faq-list">
            {#each group.entries as entry (entry.key)}
              {@const isOpen = openKey === entry.key}
              <div class="faq-item" class:faq-item-open={isOpen}>
                <button type="button" class="faq-question" onclick={() => toggle(entry.key)}>
                  <span class="faq-chevron" class:faq-chevron-open={isOpen}>
                    <ChevronRight size={16} />
                  </span>
                  <span>{entry.question}</span>
                </button>
                {#if isOpen}
                  <div class="faq-answer"><ContentBody body={entry.answer} compact /></div>
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>
</PageContainer>

<style src="./page.css"></style>
