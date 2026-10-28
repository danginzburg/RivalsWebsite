import { describe, expect, it } from 'vitest'
import { parseContent, parseInline } from './format'
import { normalizeRulebook, normalizeFaq, validateSiteContent } from './documents'

describe('parseContent', () => {
  it('splits paragraphs, lists, headings and notes', () => {
    const blocks = parseContent(
      'Intro line one\nline two\n\n### Rules\n- a\n- b\n1. first\n2) second\n> Heads up\n> twice'
    )
    expect(blocks.map((b) => b.type)).toEqual(['p', 'h', 'ul', 'ol', 'note'])
    expect(blocks[0]).toMatchObject({
      type: 'p',
      lines: [[{ text: 'Intro line one' }], [{ text: 'line two' }]],
    })
    expect(blocks[2]).toMatchObject({ type: 'ul', items: [[{ text: 'a' }], [{ text: 'b' }]] })
    expect(blocks[4]).toMatchObject({
      type: 'note',
      lines: [[{ text: 'Heads up' }], [{ text: 'twice' }]],
    })
  })

  it('handles Windows line endings', () => {
    expect(parseContent('a\r\n\r\nb').map((b) => b.type)).toEqual(['p', 'p'])
  })
})

describe('parseInline', () => {
  it('parses bold, italic and safe links', () => {
    expect(parseInline('**Bold** and *it* see [rules](/rulebook)')).toEqual([
      { type: 'bold', text: 'Bold' },
      { type: 'text', text: ' and ' },
      { type: 'italic', text: 'it' },
      { type: 'text', text: ' see ' },
      { type: 'link', text: 'rules', href: '/rulebook', external: false },
    ])
  })

  it('leaves unsafe link schemes as plain text', () => {
    expect(parseInline('[x](javascript:alert(1))')[0].type).toBe('text')
  })
})

describe('normalizeRulebook', () => {
  it('fills missing anchors from titles and de-duplicates them', () => {
    const doc = normalizeRulebook({
      sections: [
        { title: 'Match Rules', body: '', subsections: [{ title: 'Overtime' }] },
        { title: 'Match Rules', anchor: '' },
        { title: '', anchor: 'Custom Anchor!' },
      ],
    })
    expect(doc.sections.map((s) => s.anchor)).toEqual([
      'match-rules',
      'match-rules-2',
      'custom-anchor',
    ])
    expect(doc.sections[0].subsections[0].anchor).toBe('overtime')
    expect(doc.sections.every((s) => s.key.length > 0)).toBe(true)
  })

  it('survives garbage input', () => {
    expect(normalizeRulebook(null)).toEqual({ intro: '', sections: [] })
    expect(normalizeFaq('nope')).toEqual({ intro: '', categories: [] })
  })
})

describe('validateSiteContent', () => {
  it('requires titles and questions', () => {
    const faq = normalizeFaq({ categories: [{ title: '', entries: [{ question: '' }] }] })
    expect(validateSiteContent('faq', faq)).toHaveLength(2)
    const rulebook = normalizeRulebook({ sections: [{ title: 'Ok' }] })
    expect(validateSiteContent('rulebook', rulebook)).toEqual([])
  })
})
