<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import { HelpCircle, ChevronRight } from 'lucide-svelte'
  import { FAQ_CONTENT } from '$lib/content/faq'

  let openKey = $state<string | null>(null)
  let search = $state('')

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase()
    if (!q) return FAQ_CONTENT

    return FAQ_CONTENT.map((group) => ({
      ...group,
      entries: group.entries.filter(
        (e) => e.question.toLowerCase().includes(q) || e.answer.toLowerCase().includes(q)
      ),
    })).filter((group) => group.entries.length > 0)
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

    <input bind:value={search} class="faq-search" placeholder="Search questions..." />

    {#if filtered.length === 0}
      <div class="no-results">No questions match "{search}".</div>
    {:else}
      {#each filtered as group (group.category)}
        <section class="faq-group">
          <h2 class="faq-category">{group.category}</h2>
          <div class="faq-list">
            {#each group.entries as entry (entry.question)}
              {@const key = `${group.category}::${entry.question}`}
              {@const isOpen = openKey === key}
              <div class="faq-item" class:faq-item-open={isOpen}>
                <button type="button" class="faq-question" onclick={() => toggle(key)}>
                  <span class="faq-chevron" class:faq-chevron-open={isOpen}>
                    <ChevronRight size={16} />
                  </span>
                  <span>{entry.question}</span>
                </button>
                {#if isOpen}
                  <div class="faq-answer">{entry.answer}</div>
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>
</PageContainer>

<style>
  .faq-search {
    width: 100%;
    padding: 0.625rem 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
    color: var(--text);
    font-size: 0.875rem;
    margin-bottom: 1.5rem;
  }

  .faq-search::placeholder {
    color: rgba(255, 255, 255, 0.56);
  }

  .faq-search:focus {
    outline: none;
    border-color: var(--hover);
  }

  .faq-group {
    margin-bottom: 2rem;
  }

  .faq-category {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.64);
    margin-bottom: 0.625rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .faq-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .faq-item {
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(0, 0, 0, 0.18);
    overflow: hidden;
    transition: border-color 0.15s;
  }

  .faq-item:hover {
    border-color: rgba(255, 255, 255, 0.12);
  }

  .faq-item-open {
    border-color: rgba(120, 67, 145, 0.4);
  }

  .faq-question {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    width: 100%;
    padding: 0.875rem 1rem;
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 0.9375rem;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    line-height: 1.4;
  }

  .faq-chevron {
    display: flex;
    align-items: center;
    color: rgba(255, 255, 255, 0.6);
    transition: transform 0.2s;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .faq-chevron-open {
    transform: rotate(90deg);
    color: var(--accent-text);
  }

  .faq-answer {
    padding: 0 1rem 1rem 2.25rem;
    font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.65);
    line-height: 1.6;
  }

  .no-results {
    padding: 3rem 1rem;
    text-align: center;
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.875rem;
  }

  @media (max-width: 640px) {
    .faq-question {
      font-size: 0.875rem;
      padding: 0.75rem 0.875rem;
    }

    .faq-answer {
      padding: 0 0.875rem 0.875rem 2rem;
      font-size: 0.8125rem;
    }
  }
</style>
