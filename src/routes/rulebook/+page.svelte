<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import ContentBody from '$lib/components/content/ContentBody.svelte'
  import { BookOpen } from 'lucide-svelte'
  import { contentPlainText } from '$lib/content/format'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  /** Hidden sections are drafts: kept in the editor, never shown here. */
  const sections = $derived(
    data.rulebook.sections
      .filter((s) => !s.hidden)
      .map((s) => ({ ...s, subsections: s.subsections.filter((sub) => !sub.hidden) }))
  )

  let activeId = $state<string>('')
  let search = $state('')

  const matches = (q: string, title: string, body: string) =>
    title.toLowerCase().includes(q) || contentPlainText(body).toLowerCase().includes(q)

  /** A section stays when it or any subsection matches; only matching subsections show. */
  const filteredSections = $derived.by(() => {
    // Number before filtering so search results keep their real section numbers.
    const numbered = sections.map((s, i) => ({
      ...s,
      number: `${i + 1}`,
      subsections: s.subsections.map((sub, j) => ({ ...sub, number: `${i + 1}.${j + 1}` })),
    }))
    const q = search.trim().toLowerCase()
    if (!q) return numbered
    return numbered
      .map((s) => {
        if (matches(q, s.title, s.body)) return s
        const subsections = s.subsections.filter((sub) => matches(q, sub.title, sub.body))
        return subsections.length > 0 ? { ...s, subsections } : null
      })
      .filter((s) => s !== null)
  })

  function scrollTo(id: string) {
    activeId = id
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** Highlight the section currently in view. */
  function onScroll() {
    for (const section of sections) {
      const el = document.getElementById(section.anchor)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (rect.top <= 120 && rect.bottom > 120) {
        activeId = section.anchor
        return
      }
    }
  }
</script>

<svelte:head><title>Rulebook</title></svelte:head>
<svelte:window onscroll={onScroll} />

<PageContainer>
  <div class="rulebook">
    <!-- Table of contents -->
    <aside class="toc">
      <div class="toc-sticky">
        <div class="toc-card">
          <div class="toc-head">
            <span class="toc-label">Contents</span>
            <span class="toc-count">{sections.length}</span>
          </div>
          <nav class="toc-nav">
            {#each sections as section, index (section.key)}
              <button
                type="button"
                class="toc-link"
                class:toc-link-active={(activeId || sections[0]?.anchor) === section.anchor}
                onclick={() => scrollTo(section.anchor)}
              >
                <span class="toc-num">{index + 1}</span>
                <span class="toc-text">{section.title}</span>
              </button>
            {/each}
          </nav>
        </div>
      </div>
    </aside>

    <!-- Content -->
    <div class="rulebook-body">
      <div class="rulebook-header">
        <PageHeading title="Rulebook" subtitle="Last updated {data.updatedOn}" icon={BookOpen} />
      </div>

      <input bind:value={search} class="rulebook-search" placeholder="Search the rulebook..." />

      {#if data.rulebook.intro.trim() && !search.trim()}
        <div class="rule-intro"><ContentBody body={data.rulebook.intro} /></div>
      {/if}

      {#if sections.length === 0}
        <div class="no-results">The rulebook hasn't been published yet.</div>
      {:else if filteredSections.length === 0}
        <div class="no-results">No sections match "{search}".</div>
      {:else}
        {#each filteredSections as section (section.key)}
          <section id={section.anchor} class="rule-section">
            <h2 class="rule-title">
              <span class="rule-num">{section.number}.</span>
              {section.title}
            </h2>
            {#if section.body.trim()}
              <ContentBody body={section.body} />
            {/if}
            {#each section.subsections as sub (sub.key)}
              <div id={sub.anchor} class="rule-subsection">
                <h3 class="rule-subtitle">
                  <span class="rule-num">{sub.number}</span>
                  {sub.title}
                </h3>
                {#if sub.body.trim()}
                  <ContentBody body={sub.body} />
                {/if}
              </div>
            {/each}
          </section>
        {/each}
      {/if}
    </div>
  </div>
</PageContainer>

<style>
  .rulebook {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 2.5rem;
    width: 100%;
    max-width: 72rem;
    margin: 0 auto;
    padding: 1.5rem 0 4rem;
  }

  /*
   * Table of contents — a raised card rather than a bare list. On a long
   * rulebook the nav is the primary way in, so it needs to read as a control
   * panel and not as more page text.
   */
  .toc-sticky {
    position: sticky;
    top: 5rem;
  }

  .toc-card {
    border-radius: 0.875rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.3);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
    overflow: hidden;
  }

  .toc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.625rem 0.875rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    background: linear-gradient(180deg, rgba(120, 67, 145, 0.35), rgba(120, 67, 145, 0.12));
  }

  .toc-label {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.11em;
    color: var(--text);
  }

  .toc-count {
    padding: 0.0625rem 0.4375rem;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.14);
    color: rgba(255, 255, 255, 0.8);
    font-size: 0.625rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .toc-nav {
    display: flex;
    flex-direction: column;
    padding: 0.375rem;
    gap: 0.0625rem;
  }

  .toc-link {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4375rem 0.5rem;
    border-radius: 0.4375rem;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.62);
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
    transition:
      color 0.15s,
      background 0.15s;
    line-height: 1.35;
  }

  /* Step numbers give the list a spine the eye can track down. */
  .toc-num {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 0.3125rem;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.55);
    font-size: 0.625rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .toc-link:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
  }

  .toc-link:hover .toc-num {
    background: rgba(255, 255, 255, 0.14);
    color: var(--text);
  }

  .toc-link-active {
    color: var(--text);
    background: var(--accent);
    font-weight: 600;
  }

  .toc-link-active .toc-num {
    background: var(--hover);
    color: var(--text);
  }

  /* Content */
  .rulebook-header {
    margin-bottom: 1.25rem;
  }

  .rulebook-search {
    width: 100%;
    max-width: 24rem;
    padding: 0.5rem 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
    color: var(--text);
    font-size: 0.8125rem;
    margin-bottom: 2rem;
  }

  .rulebook-search::placeholder {
    color: rgba(255, 255, 255, 0.56);
  }

  .rulebook-search:focus {
    outline: none;
    border-color: var(--hover);
  }

  .rule-section {
    margin-bottom: 2.5rem;
    scroll-margin-top: 5rem;
  }

  .rule-title {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--title);
    margin-bottom: 0.75rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .rule-num {
    margin-right: 0.375rem;
    color: var(--accent-text);
    font-variant-numeric: tabular-nums;
  }

  .rule-intro {
    margin-bottom: 2rem;
  }

  .rule-subsection {
    margin-top: 1.5rem;
    scroll-margin-top: 5rem;
  }

  .rule-subtitle {
    font-size: 1rem;
    font-weight: 600;
    color: var(--title);
    margin-bottom: 0.5rem;
  }

  .no-results {
    padding: 3rem 1rem;
    text-align: center;
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.875rem;
  }

  /* Mobile — TOC collapses to a horizontal scroller above the content */
  @media (max-width: 900px) {
    .rulebook {
      grid-template-columns: minmax(0, 1fr);
      gap: 1.25rem;
      padding: 1rem 0 3rem;
    }

    .toc {
      order: -1;
    }

    .toc-sticky {
      position: static;
    }

    /* Same card, laid out as a horizontal scroller of chips. */
    .toc-nav {
      flex-direction: row;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      gap: 0.25rem;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
    }

    .toc-nav::-webkit-scrollbar {
      height: 3px;
    }

    .toc-nav::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 3px;
    }

    .toc-link {
      flex-shrink: 0;
      white-space: nowrap;
      font-size: 0.75rem;
      padding: 0.375rem 0.5rem;
    }
  }
</style>
