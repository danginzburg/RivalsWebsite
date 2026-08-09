<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { BookOpen } from 'lucide-svelte'
  import { RULEBOOK_SECTIONS, RULEBOOK_UPDATED, type RulebookSection } from '$lib/content/rulebook'

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
        <div class="toc-label">Contents</div>
        <nav class="toc-nav">
          {#each RULEBOOK_SECTIONS as section (section.id)}
            <button
              type="button"
              class="toc-link"
              class:toc-link-active={activeId === section.id}
              onclick={() => scrollTo(section.id)}
            >
              {section.title}
            </button>
          {/each}
        </nav>
      </div>
    </aside>

    <!-- Content -->
    <div class="rulebook-body">
      <div class="rulebook-header">
        <div class="flex items-center gap-3">
          <BookOpen size={32} style="color: var(--text); flex-shrink: 0;" />
          <div>
            <h1 class="rulebook-title">Rulebook</h1>
            <p class="rulebook-updated">Last updated {RULEBOOK_UPDATED}</p>
          </div>
        </div>
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

  /* Table of contents */
  .toc-sticky {
    position: sticky;
    top: 5rem;
  }

  .toc-label {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: rgba(255, 255, 255, 0.4);
    margin-bottom: 0.75rem;
  }

  .toc-nav {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
  }

  .toc-link {
    padding: 0.375rem 0.75rem;
    background: transparent;
    border: none;
    border-left: 2px solid transparent;
    margin-left: -1px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
    transition:
      color 0.15s,
      border-color 0.15s;
    line-height: 1.4;
  }

  .toc-link:hover {
    color: rgba(255, 255, 255, 0.85);
  }

  .toc-link-active {
    color: var(--text);
    border-left-color: var(--hover);
    font-weight: 600;
  }

  /* Content */
  .rulebook-header {
    margin-bottom: 1.25rem;
  }

  .rulebook-title {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--title);
    line-height: 1.2;
  }

  .rulebook-updated {
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.45);
    margin-top: 0.125rem;
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
    color: rgba(255, 255, 255, 0.35);
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

    .toc-nav {
      flex-direction: row;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      border-left: none;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 0.25rem;
      gap: 0.25rem;
    }

    .toc-link {
      white-space: nowrap;
      border-left: none;
      border-bottom: 2px solid transparent;
      margin-left: 0;
      margin-bottom: -1px;
      font-size: 0.75rem;
      padding: 0.375rem 0.625rem;
    }

    .toc-link-active {
      border-left-color: transparent;
      border-bottom-color: var(--hover);
    }

    .rulebook-title {
      font-size: 1.375rem;
    }

    .rule-para,
    .rule-list li {
      font-size: 0.875rem;
    }
  }
</style>
