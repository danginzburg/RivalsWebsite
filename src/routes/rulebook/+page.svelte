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

<style src="./page.css"></style>
