import { describe, expect, it } from 'vitest'
import { toExcerpt, EXCERPT_MAX_LENGTH } from './recent'

describe('toExcerpt', () => {
  it('leaves a short body untouched', () => {
    expect(toExcerpt('Great match!')).toBe('Great match!')
  })

  it('collapses newlines and runs of whitespace to single spaces', () => {
    expect(toExcerpt('first line\n\n  second   line\t')).toBe('first line second line')
  })

  it('truncates on a word boundary when one is close to the limit', () => {
    const body = 'alpha bravo charlie delta echo foxtrot'
    expect(toExcerpt(body, 20)).toBe('alpha bravo charlie…')
  })

  it('hard-cuts when the last word runs past the limit on its own', () => {
    // A single long token has no usable space, so the cut lands mid-word.
    const body = `${'x'.repeat(30)} tail`
    expect(toExcerpt(body, 10)).toBe(`${'x'.repeat(10)}…`)
  })

  it('never exceeds the limit plus the ellipsis', () => {
    const body = 'word '.repeat(200)
    const excerpt = toExcerpt(body)
    expect(excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX_LENGTH + 1)
    expect(excerpt.endsWith('…')).toBe(true)
  })

  it('does not add an ellipsis at exactly the limit', () => {
    const body = 'a'.repeat(EXCERPT_MAX_LENGTH)
    expect(toExcerpt(body)).toBe(body)
  })
})
