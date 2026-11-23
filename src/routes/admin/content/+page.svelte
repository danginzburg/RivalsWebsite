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
  const activeEditor = $derived(activeTab === 'rulebook' ? rulebook : faq)
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
            editor until you press Save; hidden items are kept here but not shown publicly. An
            unpublished page and its links stay hidden from everyone but admins.
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
          <label class="ce-check" title="Takes effect when you press Save">
            <input type="checkbox" bind:checked={activeEditor.draft.published} /> Published
          </label>
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

<style src="./page.css"></style>
