<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import ContentBody from '$lib/components/content/ContentBody.svelte'
  import {
    ArrowLeft,
    BookOpen,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    ExternalLink,
    Eye,
    EyeOff,
    HelpCircle,
    Loader2,
    Plus,
    RotateCcw,
    Save,
    Trash2,
  } from 'lucide-svelte'
  import { resolve } from '$app/paths'
  import { onMount } from 'svelte'
  import {
    newContentKey,
    slugify,
    validateSiteContent,
    type FaqCategory,
    type FaqDocument,
    type RulebookDocument,
    type RulebookSection,
    type SiteContentKey,
  } from '$lib/content/documents'
  import { FORMAT_HELP } from '$lib/content/format'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  /*
   * Each document is edited as one draft and saved whole. Nothing reaches the
   * public page until Save, so add/remove/reorder act freely on the draft and
   * "Discard" puts back the last saved version.
   */
  type Editor<T> = { draft: T; saved: string; updatedAt: string | null }

  const snapshot = (value: unknown) => JSON.stringify(value)

  function editorFor<T>(record: { document: T; updatedAt: string | null }): Editor<T> {
    return {
      draft: structuredClone(record.document),
      saved: snapshot(record.document),
      updatedAt: record.updatedAt,
    }
  }

  // Seeded once from the load; later saves update these in place.
  // svelte-ignore state_referenced_locally
  let rulebook = $state(editorFor<RulebookDocument>(data.rulebook))
  // svelte-ignore state_referenced_locally
  let faq = $state(editorFor<FaqDocument>(data.faq))

  let activeTab = $state<SiteContentKey>('rulebook')
  let showPreview = $state(false)
  let showFormatHelp = $state(false)
  let isSaving = $state(false)
  let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null)
  /** Expanded cards, by item key. */
  let expanded = $state<Record<string, boolean>>({})

  const rulebookDirty = $derived(snapshot(rulebook.draft) !== rulebook.saved)
  const faqDirty = $derived(snapshot(faq.draft) !== faq.saved)
  const activeDirty = $derived(activeTab === 'rulebook' ? rulebookDirty : faqDirty)
  const activeUpdatedAt = $derived(activeTab === 'rulebook' ? rulebook.updatedAt : faq.updatedAt)

  onMount(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (rulebookDirty || faqDirty) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  })

  function toggle(key: string) {
    expanded[key] = !expanded[key]
  }

  function move<T>(list: T[], index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= list.length) return
    const [item] = list.splice(index, 1)
    list.splice(target, 0, item)
  }

  function remove<T>(list: T[], index: number) {
    list.splice(index, 1)
  }

  function addSection() {
    const key = newContentKey()
    rulebook.draft.sections.push({
      key,
      anchor: '',
      title: '',
      body: '',
      hidden: false,
      subsections: [],
    })
    expanded[key] = true
  }

  function addSubsection(section: RulebookSection) {
    const key = newContentKey()
    section.subsections.push({ key, anchor: '', title: '', body: '', hidden: false })
    expanded[section.key] = true
    expanded[key] = true
  }

  function addCategory() {
    const key = newContentKey()
    faq.draft.categories.push({ key, title: '', hidden: false, entries: [] })
    expanded[key] = true
  }

  function addQuestion(category: FaqCategory) {
    const key = newContentKey()
    category.entries.push({ key, question: '', answer: '', hidden: false })
    expanded[category.key] = true
    expanded[key] = true
  }

  function setAll(open: boolean) {
    const keys =
      activeTab === 'rulebook'
        ? rulebook.draft.sections.map((s) => s.key)
        : faq.draft.categories.map((c) => c.key)
    for (const key of keys) expanded[key] = open
  }

  function discard() {
    const editor = activeTab === 'rulebook' ? rulebook : faq
    editor.draft = JSON.parse(editor.saved)
    message = null
  }

  async function save() {
    const key = activeTab
    const editor = key === 'rulebook' ? rulebook : faq
    const document = $state.snapshot(editor.draft)

    const problems = validateSiteContent(key, document as never)
    if (problems.length > 0) {
      message = { kind: 'error', text: problems.join(' ') }
      return
    }

    isSaving = true
    message = null
    try {
      const response = await fetch('/api/admin/site-content', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, document, expectedUpdatedAt: editor.updatedAt }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message ?? 'Save failed')

      // The server fills in anchors and trims text; adopt its version.
      editor.draft = result.document
      editor.saved = snapshot(result.document)
      editor.updatedAt = result.updatedAt
      message = {
        kind: 'ok',
        text: `${key === 'rulebook' ? 'Rulebook' : 'FAQ'} saved. The public page updates within a minute.`,
      }
    } catch (err) {
      message = { kind: 'error', text: err instanceof Error ? err.message : 'Save failed' }
    } finally {
      isSaving = false
    }
  }

  function formatTime(iso: string | null) {
    return iso ? new Date(iso).toLocaleString() : 'never (showing the built-in default)'
  }
</script>

<svelte:head><title>Edit Rulebook & FAQ</title></svelte:head>

{#snippet controls(list: unknown[], index: number, item: { hidden: boolean }, label: string)}
  <div class="ce-controls">
    <button
      type="button"
      class="ce-icon-btn"
      title="Move up"
      aria-label="Move {label} up"
      disabled={index === 0}
      onclick={() => move(list, index, -1)}><ChevronUp size={15} /></button
    >
    <button
      type="button"
      class="ce-icon-btn"
      title="Move down"
      aria-label="Move {label} down"
      disabled={index === list.length - 1}
      onclick={() => move(list, index, 1)}><ChevronDown size={15} /></button
    >
    <button
      type="button"
      class="ce-icon-btn"
      class:ce-icon-btn-on={item.hidden}
      title={item.hidden
        ? 'Hidden from the public page — click to show'
        : 'Hide from the public page'}
      aria-label={item.hidden ? `Show ${label}` : `Hide ${label}`}
      onclick={() => (item.hidden = !item.hidden)}
    >
      {#if item.hidden}<EyeOff size={15} />{:else}<Eye size={15} />{/if}
    </button>
    <button
      type="button"
      class="ce-icon-btn ce-icon-btn-danger"
      title="Delete"
      aria-label="Delete {label}"
      onclick={() => remove(list, index)}><Trash2 size={15} /></button
    >
  </div>
{/snippet}

{#snippet bodyField(value: string, onInput: (v: string) => void, placeholder: string, rows = 6)}
  <textarea
    class="admin-textarea ce-body"
    {rows}
    {placeholder}
    {value}
    oninput={(e) => onInput(e.currentTarget.value)}
  ></textarea>
  {#if showPreview && value.trim()}
    <div class="ce-preview">
      <span class="ce-preview-label">Preview</span>
      <ContentBody body={value} />
    </div>
  {/if}
{/snippet}

<PageContainer>
  <div class="flex justify-center py-6 sm:py-8">
    <div class="w-full max-w-4xl space-y-5">
      <header class="admin-import-head">
        <div class="min-w-0">
          <h1 class="admin-import-title">Rulebook & FAQ</h1>
          <p class="admin-hint mt-1">
            Add, reorder, hide and delete sections and questions, then save. Changes stay in this
            editor until you press Save; hidden items are kept here but not shown publicly.
          </p>
        </div>
        <div class="flex flex-shrink-0 items-center gap-2">
          <a href={resolve('/admin')} class="admin-back-link">
            <ArrowLeft size={14} /> Admin
          </a>
        </div>
      </header>

      <div class="ce-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'rulebook'}
          class="ce-tab"
          class:ce-tab-active={activeTab === 'rulebook'}
          onclick={() => ((activeTab = 'rulebook'), (message = null))}
        >
          <BookOpen size={16} /> Rulebook
          {#if rulebookDirty}<span class="ce-dot" title="Unsaved changes"></span>{/if}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'faq'}
          class="ce-tab"
          class:ce-tab-active={activeTab === 'faq'}
          onclick={() => ((activeTab = 'faq'), (message = null))}
        >
          <HelpCircle size={16} /> FAQ
          {#if faqDirty}<span class="ce-dot" title="Unsaved changes"></span>{/if}
        </button>
      </div>

      <!-- Sticky so Save is always in reach on a long document. -->
      <div class="ce-toolbar">
        <div class="ce-toolbar-meta">
          <span>Last saved: {formatTime(activeUpdatedAt)}</span>
          {#if activeDirty}<span class="ce-unsaved">Unsaved changes</span>{/if}
        </div>
        <div class="ce-toolbar-actions">
          <label class="ce-check">
            <input type="checkbox" bind:checked={showPreview} /> Preview
          </label>
          <button
            type="button"
            class="admin-btn admin-btn-sm admin-btn-neutral"
            onclick={() => setAll(true)}
          >
            Expand all
          </button>
          <button
            type="button"
            class="admin-btn admin-btn-sm admin-btn-neutral"
            onclick={() => setAll(false)}
          >
            Collapse all
          </button>
          <a
            href={resolve(activeTab === 'rulebook' ? '/rulebook' : '/faq')}
            target="_blank"
            rel="noopener"
            class="admin-btn admin-btn-sm admin-btn-neutral"
          >
            <ExternalLink size={14} /> View page
          </a>
          <button
            type="button"
            class="admin-btn admin-btn-sm admin-btn-neutral"
            disabled={!activeDirty || isSaving}
            onclick={discard}
          >
            <RotateCcw size={14} /> Discard
          </button>
          <button
            type="button"
            class="admin-btn admin-btn-sm admin-btn-primary"
            disabled={!activeDirty || isSaving}
            onclick={save}
          >
            {#if isSaving}<Loader2 size={14} class="animate-spin" />{:else}<Save size={14} />{/if}
            Save
          </button>
        </div>
      </div>

      {#if message}
        <div
          class={`admin-alert ${message.kind === 'error' ? 'admin-alert-error' : 'admin-alert-success'}`}
        >
          {message.text}
        </div>
      {/if}

      <div class="admin-card admin-card-pad">
        <button
          type="button"
          class="ce-help-toggle"
          onclick={() => (showFormatHelp = !showFormatHelp)}
        >
          {#if showFormatHelp}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
          Formatting guide
        </button>
        {#if showFormatHelp}
          <dl class="ce-help">
            {#each FORMAT_HELP as [syntax, meaning] (syntax)}
              <dt><code>{syntax}</code></dt>
              <dd>{meaning}</dd>
            {/each}
          </dl>
        {/if}
      </div>

      {#if activeTab === 'rulebook'}
        <div class="admin-card admin-card-pad space-y-2">
          <span class="admin-label">Introduction (optional, shown above section 1)</span>
          {@render bodyField(
            rulebook.draft.intro,
            (v) => (rulebook.draft.intro = v),
            'A short welcome or summary…',
            3
          )}
        </div>

        <div class="space-y-3">
          {#each rulebook.draft.sections as section, i (section.key)}
            <div class="ce-card" class:ce-card-hidden={section.hidden}>
              <div class="ce-card-head">
                <button type="button" class="ce-card-toggle" onclick={() => toggle(section.key)}>
                  {#if expanded[section.key]}<ChevronDown size={16} />{:else}<ChevronRight
                      size={16}
                    />{/if}
                  <span class="ce-num">{i + 1}.</span>
                  <span class="ce-card-title">{section.title || 'Untitled section'}</span>
                  {#if section.hidden}<span class="ce-pill">Hidden</span>{/if}
                  {#if section.subsections.length > 0}
                    <span class="ce-count">{section.subsections.length} sub</span>
                  {/if}
                </button>
                {@render controls(rulebook.draft.sections, i, section, `section ${i + 1}`)}
              </div>

              {#if expanded[section.key]}
                <div class="ce-card-body">
                  <div class="admin-grid-2">
                    <label class="space-y-1">
                      <span class="admin-label">Title</span>
                      <input
                        class="admin-input"
                        bind:value={section.title}
                        placeholder="Match Rules"
                      />
                    </label>
                    <label class="space-y-1">
                      <span class="admin-label">Link anchor</span>
                      <input
                        class="admin-input"
                        bind:value={section.anchor}
                        placeholder={slugify(section.title) || 'auto from title'}
                      />
                    </label>
                  </div>
                  <div class="space-y-1">
                    <span class="admin-label">Body</span>
                    {@render bodyField(
                      section.body,
                      (v) => (section.body = v),
                      'Section text. Use - for bullets, 1. for numbered rules.'
                    )}
                  </div>

                  <div class="ce-subs">
                    {#each section.subsections as sub, j (sub.key)}
                      <div class="ce-card ce-card-sub" class:ce-card-hidden={sub.hidden}>
                        <div class="ce-card-head">
                          <button
                            type="button"
                            class="ce-card-toggle"
                            onclick={() => toggle(sub.key)}
                          >
                            {#if expanded[sub.key]}<ChevronDown size={15} />{:else}<ChevronRight
                                size={15}
                              />{/if}
                            <span class="ce-num">{i + 1}.{j + 1}</span>
                            <span class="ce-card-title">{sub.title || 'Untitled subsection'}</span>
                            {#if sub.hidden}<span class="ce-pill">Hidden</span>{/if}
                          </button>
                          {@render controls(
                            section.subsections,
                            j,
                            sub,
                            `subsection ${i + 1}.${j + 1}`
                          )}
                        </div>
                        {#if expanded[sub.key]}
                          <div class="ce-card-body">
                            <div class="admin-grid-2">
                              <label class="space-y-1">
                                <span class="admin-label">Title</span>
                                <input class="admin-input" bind:value={sub.title} />
                              </label>
                              <label class="space-y-1">
                                <span class="admin-label">Link anchor</span>
                                <input
                                  class="admin-input"
                                  bind:value={sub.anchor}
                                  placeholder={slugify(sub.title) || 'auto from title'}
                                />
                              </label>
                            </div>
                            <div class="space-y-1">
                              <span class="admin-label">Body</span>
                              {@render bodyField(
                                sub.body,
                                (v) => (sub.body = v),
                                'Subsection text…',
                                4
                              )}
                            </div>
                          </div>
                        {/if}
                      </div>
                    {/each}
                    <button
                      type="button"
                      class="admin-btn admin-btn-sm admin-btn-neutral"
                      onclick={() => addSubsection(section)}
                    >
                      <Plus size={14} /> Add subsection
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          {:else}
            <p class="admin-hint">No sections yet.</p>
          {/each}
        </div>

        <button type="button" class="admin-btn admin-btn-accent" onclick={addSection}>
          <Plus size={16} /> Add section
        </button>
      {:else}
        <div class="admin-card admin-card-pad space-y-2">
          <span class="admin-label">Introduction (optional, shown above the questions)</span>
          {@render bodyField(
            faq.draft.intro,
            (v) => (faq.draft.intro = v),
            "Can't find your answer? Ask in Discord…",
            3
          )}
        </div>

        <div class="space-y-3">
          {#each faq.draft.categories as category, i (category.key)}
            <div class="ce-card" class:ce-card-hidden={category.hidden}>
              <div class="ce-card-head">
                <button type="button" class="ce-card-toggle" onclick={() => toggle(category.key)}>
                  {#if expanded[category.key]}<ChevronDown size={16} />{:else}<ChevronRight
                      size={16}
                    />{/if}
                  <span class="ce-card-title">{category.title || 'Untitled category'}</span>
                  {#if category.hidden}<span class="ce-pill">Hidden</span>{/if}
                  <span class="ce-count">
                    {category.entries.length}
                    {category.entries.length === 1 ? 'question' : 'questions'}
                  </span>
                </button>
                {@render controls(faq.draft.categories, i, category, `category ${i + 1}`)}
              </div>

              {#if expanded[category.key]}
                <div class="ce-card-body">
                  <label class="space-y-1">
                    <span class="admin-label">Category name</span>
                    <input
                      class="admin-input"
                      bind:value={category.title}
                      placeholder="Getting Started"
                    />
                  </label>

                  <div class="ce-subs">
                    {#each category.entries as entry, j (entry.key)}
                      <div class="ce-card ce-card-sub" class:ce-card-hidden={entry.hidden}>
                        <div class="ce-card-head">
                          <button
                            type="button"
                            class="ce-card-toggle"
                            onclick={() => toggle(entry.key)}
                          >
                            {#if expanded[entry.key]}<ChevronDown size={15} />{:else}<ChevronRight
                                size={15}
                              />{/if}
                            <span class="ce-card-title"
                              >{entry.question || 'Untitled question'}</span
                            >
                            {#if entry.hidden}<span class="ce-pill">Hidden</span>{/if}
                          </button>
                          {@render controls(category.entries, j, entry, `question ${j + 1}`)}
                        </div>
                        {#if expanded[entry.key]}
                          <div class="ce-card-body">
                            <label class="space-y-1">
                              <span class="admin-label">Question</span>
                              <input class="admin-input" bind:value={entry.question} />
                            </label>
                            <div class="space-y-1">
                              <span class="admin-label">Answer</span>
                              {@render bodyField(
                                entry.answer,
                                (v) => (entry.answer = v),
                                'The answer…',
                                4
                              )}
                            </div>
                          </div>
                        {/if}
                      </div>
                    {/each}
                    <button
                      type="button"
                      class="admin-btn admin-btn-sm admin-btn-neutral"
                      onclick={() => addQuestion(category)}
                    >
                      <Plus size={14} /> Add question
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          {:else}
            <p class="admin-hint">No categories yet.</p>
          {/each}
        </div>

        <button type="button" class="admin-btn admin-btn-accent" onclick={addCategory}>
          <Plus size={16} /> Add category
        </button>
      {/if}
    </div>
  </div>
</PageContainer>

<style>
  .ce-tabs {
    display: flex;
    gap: 0.375rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .ce-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: rgba(255, 255, 255, 0.62);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    margin-bottom: -1px;
  }

  .ce-tab:hover {
    color: var(--text);
  }

  .ce-tab-active {
    color: var(--text);
    border-bottom-color: var(--hover);
  }

  .ce-dot {
    width: 0.4375rem;
    height: 0.4375rem;
    border-radius: 50%;
    background: #fbbf24;
  }

  .ce-toolbar {
    position: sticky;
    top: 4.5rem;
    z-index: 10;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.625rem 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.75rem;
    background: var(--secondary-background);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  .ce-toolbar-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.625rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .ce-unsaved {
    color: #fcd34d;
    font-weight: 700;
  }

  .ce-toolbar-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
  }

  .ce-toolbar-actions :global(.admin-btn) {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
  }

  .ce-check {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    margin-right: 0.25rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.75);
    cursor: pointer;
  }

  .ce-help-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
  }

  .ce-help {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.375rem 1rem;
    margin-top: 0.75rem;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.7);
  }

  .ce-help code {
    padding: 0.0625rem 0.375rem;
    border-radius: 0.25rem;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text);
  }

  .ce-card {
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.75rem;
    background: rgba(0, 0, 0, 0.22);
  }

  .ce-card-sub {
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.03);
  }

  .ce-card-hidden {
    border-style: dashed;
    opacity: 0.7;
  }

  .ce-card-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.5rem 0.375rem 0.25rem;
  }

  .ce-card-toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.5rem;
    border: none;
    border-radius: 0.5rem;
    background: transparent;
    color: var(--text);
    font-size: 0.875rem;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .ce-card-toggle:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .ce-card-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ce-num {
    flex-shrink: 0;
    color: var(--accent-text);
    font-variant-numeric: tabular-nums;
  }

  .ce-pill,
  .ce-count {
    flex-shrink: 0;
    padding: 0.0625rem 0.4375rem;
    border-radius: 9999px;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .ce-pill {
    background: rgba(251, 191, 36, 0.16);
    color: #fcd34d;
  }

  .ce-count {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.6);
  }

  .ce-controls {
    display: flex;
    flex-shrink: 0;
    gap: 0.125rem;
  }

  .ce-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.875rem;
    height: 1.875rem;
    border: none;
    border-radius: 0.4375rem;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
  }

  .ce-icon-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text);
  }

  .ce-icon-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .ce-icon-btn-on {
    color: #fcd34d;
  }

  .ce-icon-btn-danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.16);
    color: #fca5a5;
  }

  .ce-card-body {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    padding: 0.25rem 0.875rem 0.875rem;
  }

  .ce-body {
    width: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8125rem;
    line-height: 1.55;
    resize: vertical;
  }

  .ce-preview {
    margin-top: 0.5rem;
    padding: 0.75rem 0.875rem;
    border: 1px dashed rgba(255, 255, 255, 0.15);
    border-radius: 0.5rem;
  }

  .ce-preview-label {
    display: block;
    margin-bottom: 0.375rem;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.45);
  }

  .ce-subs {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding-left: 0.75rem;
    border-left: 2px solid rgba(255, 255, 255, 0.08);
  }

  .ce-subs > .ce-card {
    width: 100%;
  }

  @media (max-width: 640px) {
    .ce-toolbar {
      top: 4rem;
    }

    .ce-card-head {
      flex-wrap: wrap;
    }

    .ce-controls {
      margin-left: auto;
    }

    .ce-subs {
      padding-left: 0.375rem;
    }
  }
</style>
