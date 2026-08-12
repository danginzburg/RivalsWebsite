<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import { BookOpen } from 'lucide-svelte'
  import { RULEBOOK_SECTIONS, RULEBOOK_UPDATED } from '$lib/content/rulebook'

  let activeId = $state<string>(RULEBOOK_SECTIONS[0]?.id ?? '')
  let search = $state('')

  const filteredSections = $derived.by(() => {
    const q = search.trim().toLowerCase()
    if (!q) return RULEBOOK_SECTIONS
    return RULEBOOK_SECTIONS.filter(
      (s) => s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q)
    )
  })

  /** Split a section body into paragraphs and bullet lists. */
  function parseBody(body: string) {
    const blocks: Array<{ type: 'p' | 'ul'; content: string[] }> = []
    for (const raw of body.split(/\n\s*\n/)) {
      const lines = raw
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      if (lines.length === 0) continue
      if (lines.every((l) => l.startsWith('- '))) {
        blocks.push({ type: 'ul', content: lines.map((l) => l.slice(2)) })
      } else {
        blocks.push({ type: 'p', content: [lines.join(' ')] })
      }
    }
    return blocks
  }

  function scrollTo(id: string) {
    activeId = id
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** Highlight the section currently in view. */
  function onScroll() {
    for (const section of RULEBOOK_SECTIONS) {
      const el = document.getElementById(section.id)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (rect.top <= 120 && rect.bottom > 120) {
        activeId = section.id
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
            <span class="toc-count">{RULEBOOK_SECTIONS.length}</span>
          </div>
          <nav class="toc-nav">
            {#each RULEBOOK_SECTIONS as section, index (section.id)}
              <button
                type="button"
                class="toc-link"
                class:toc-link-active={activeId === section.id}
                onclick={() => scrollTo(section.id)}
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
        <PageHeading title="Rulebook" subtitle="Last updated {RULEBOOK_UPDATED}" icon={BookOpen} />
      </div>

      <input bind:value={search} class="rulebook-search" placeholder="Search the rulebook..." />

      {#if filteredSections.length === 0}
        <div class="no-results">No sections match "{search}".</div>
      {:else}
        {#each filteredSections as section (section.id)}
          <section id={section.id} class="rule-section">
            <h2 class="rule-title">{section.title}</h2>
            {#each parseBody(section.body) as block, i (i)}
              {#if block.type === 'ul'}
                <ul class="rule-list">
                  {#each block.content as item, j (j)}
                    <li>{item}</li>
                  {/each}
                </ul>
              {:else}
                <p class="rule-para">{block.content[0]}</p>
              {/if}
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

  .rule-para {
    font-size: 0.9375rem;
    line-height: 1.7;
    color: rgba(255, 255, 255, 0.75);
    margin-bottom: 0.875rem;
    max-width: 62ch;
  }

  .rule-list {
    list-style: none;
    margin: 0 0 0.875rem;
    padding: 0;
    max-width: 62ch;
  }

  .rule-list li {
    position: relative;
    padding-left: 1.25rem;
    font-size: 0.9375rem;
    line-height: 1.7;
    color: rgba(255, 255, 255, 0.75);
    margin-bottom: 0.375rem;
  }

  .rule-list li::before {
    content: '';
    position: absolute;
    left: 0.25rem;
    top: 0.7em;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--hover);
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

    .rule-para,
    .rule-list li {
      font-size: 0.875rem;
    }
  }
</style>
