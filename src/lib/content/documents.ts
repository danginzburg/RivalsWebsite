/**
 * Admin-editable site documents: their shapes, validation, and the default
 * content shown until an admin saves a version (stored in `site_content`).
 *
 * The same normalizers run on the server (on save and on load, so a malformed
 * row can never break a public page) and in the admin editor.
 *
 * Bodies and answers are plain text with light formatting; see format.ts.
 */

import { FAQ_CONTENT } from './faq'
import { RULEBOOK_SECTIONS, RULEBOOK_UPDATED } from './rulebook'

export type RulebookSubsection = {
  /** Stable identity for editing and keyed lists; never shown. */
  key: string
  /** URL anchor. Derived from the title when left blank. */
  anchor: string
  title: string
  body: string
  hidden: boolean
}

export type RulebookSection = RulebookSubsection & {
  subsections: RulebookSubsection[]
}

export type RulebookDocument = {
  /** Optional text above the first section. */
  intro: string
  sections: RulebookSection[]
}

export type FaqEntry = {
  key: string
  question: string
  answer: string
  hidden: boolean
}

export type FaqCategory = {
  key: string
  title: string
  hidden: boolean
  entries: FaqEntry[]
}

export type FaqDocument = {
  intro: string
  categories: FaqCategory[]
}

export type SiteContentDocuments = {
  rulebook: RulebookDocument
  faq: FaqDocument
}

export type SiteContentKey = keyof SiteContentDocuments

export const SITE_CONTENT_KEYS: readonly SiteContentKey[] = ['rulebook', 'faq']

export function isSiteContentKey(value: unknown): value is SiteContentKey {
  return typeof value === 'string' && (SITE_CONTENT_KEYS as readonly string[]).includes(value)
}

/** A loaded document plus when it was last saved (null = still the default). */
export type SiteContentRecord<K extends SiteContentKey> = {
  document: SiteContentDocuments[K]
  updatedAt: string | null
}

const LIMITS = {
  title: 200,
  anchor: 80,
  body: 20_000,
  items: 200,
}

export function newContentKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.anchor)
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').slice(0, max) : ''
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, LIMITS.items) : []
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function key(value: unknown): string {
  const raw = text(value, 64).trim()
  return raw || newContentKey()
}

/** Gives every anchor a usable, unique slug so the table of contents never collides. */
function assignAnchors(sections: RulebookSection[]) {
  const used = new Set<string>()
  const claim = (item: RulebookSubsection, fallback: string) => {
    const base = slugify(item.anchor) || slugify(item.title) || fallback
    let anchor = base
    for (let n = 2; used.has(anchor); n++) anchor = `${base}-${n}`
    used.add(anchor)
    item.anchor = anchor
  }
  sections.forEach((section, i) => {
    claim(section, `section-${i + 1}`)
    section.subsections.forEach((sub, j) => claim(sub, `section-${i + 1}-${j + 1}`))
  })
}

function normalizeSubsection(raw: unknown): RulebookSubsection {
  const r = record(raw)
  return {
    key: key(r.key),
    anchor: text(r.anchor, LIMITS.anchor).trim(),
    title: text(r.title, LIMITS.title).trim(),
    body: text(r.body, LIMITS.body),
    hidden: r.hidden === true,
  }
}

export function normalizeRulebook(raw: unknown): RulebookDocument {
  const r = record(raw)
  const sections = list(r.sections).map((s) => ({
    ...normalizeSubsection(s),
    subsections: list(record(s).subsections).map(normalizeSubsection),
  }))
  assignAnchors(sections)
  return { intro: text(r.intro, LIMITS.body), sections }
}

export function normalizeFaq(raw: unknown): FaqDocument {
  const r = record(raw)
  return {
    intro: text(r.intro, LIMITS.body),
    categories: list(r.categories).map((c) => {
      const cat = record(c)
      return {
        key: key(cat.key),
        title: text(cat.title, LIMITS.title).trim(),
        hidden: cat.hidden === true,
        entries: list(cat.entries).map((e) => {
          const entry = record(e)
          return {
            key: key(entry.key),
            question: text(entry.question, LIMITS.title * 2).trim(),
            answer: text(entry.answer, LIMITS.body),
            hidden: entry.hidden === true,
          }
        }),
      }
    }),
  }
}

/** Problems that block a save; normalization alone fixes everything else. */
export function validateSiteContent<K extends SiteContentKey>(
  key: K,
  document: SiteContentDocuments[K]
): string[] {
  const problems: string[] = []
  if (key === 'rulebook') {
    const doc = document as RulebookDocument
    doc.sections.forEach((section, i) => {
      if (!section.title) problems.push(`Section ${i + 1} needs a title.`)
      section.subsections.forEach((sub, j) => {
        if (!sub.title) problems.push(`Section ${i + 1}.${j + 1} needs a title.`)
      })
    })
  } else {
    const doc = document as FaqDocument
    doc.categories.forEach((category, i) => {
      if (!category.title) problems.push(`Category ${i + 1} needs a name.`)
      category.entries.forEach((entry, j) => {
        if (!entry.question) {
          problems.push(`Question ${j + 1} in "${category.title || `category ${i + 1}`}" is empty.`)
        }
      })
    })
  }
  return problems
}

export function normalizeSiteContent<K extends SiteContentKey>(
  key: K,
  raw: unknown
): SiteContentDocuments[K] {
  return (
    key === 'rulebook' ? normalizeRulebook(raw) : normalizeFaq(raw)
  ) as SiteContentDocuments[K]
}

/** Shown until an admin saves the first version; built from the original hard-coded text. */
export const DEFAULT_SITE_CONTENT: SiteContentDocuments = {
  rulebook: normalizeRulebook({
    intro: '',
    sections: RULEBOOK_SECTIONS.map((s) => ({
      key: `default-${s.id}`,
      anchor: s.id,
      title: s.title,
      body: s.body,
      subsections: [],
    })),
  }),
  faq: normalizeFaq({
    intro: '',
    categories: FAQ_CONTENT.map((c) => ({
      key: `default-${slugify(c.category)}`,
      title: c.category,
      entries: c.entries.map((e) => ({
        key: `default-${slugify(e.question)}`,
        question: e.question,
        answer: e.answer,
      })),
    })),
  }),
}

/** The date the default rulebook claims, used until a saved version exists. */
export const DEFAULT_RULEBOOK_UPDATED = RULEBOOK_UPDATED
