import { describe, expect, it } from 'vitest'
import { setTimeConfirmation, setTimeProblem, type SettableMatch } from './set-time'
import { canSetMatchTime } from './threads'

const match: SettableMatch = {
  id: 'm1',
  status: 'scheduled',
  approval_status: 'approved',
  scheduled_at: null,
  pairing: 'DOM vs NABI',
}

describe('setTimeProblem', () => {
  it('allows scheduled and live matches, with or without a time', () => {
    expect(setTimeProblem(match)).toBeNull()
    expect(
      setTimeProblem({ ...match, status: 'live', scheduled_at: '2026-11-28T01:00:00Z' })
    ).toBeNull()
  })

  it('refuses finished, cancelled, unapproved and missing matches', () => {
    expect(setTimeProblem({ ...match, status: 'completed' })).toContain('completed')
    expect(setTimeProblem({ ...match, status: 'cancelled' })).toContain('cancelled')
    expect(setTimeProblem({ ...match, approval_status: 'pending' })).toContain('isn’t on the site')
    expect(setTimeProblem(null)).toContain('isn’t on the site')
  })
})

describe('setTimeConfirmation', () => {
  it('shows the time as a Discord timestamp, in each reader’s own zone', () => {
    const text = setTimeConfirmation('DOM vs NABI', 1795827600, false)
    expect(text).toContain('**DOM vs NABI** is set for <t:1795827600:F> (<t:1795827600:R>)')
    expect(setTimeConfirmation('DOM vs NABI', 1795827600, true)).toContain('is moved to')
  })
})

describe('canSetMatchTime', () => {
  it('needs Manage Threads, Manage Events or Administrator', () => {
    expect(canSetMatchTime({ permissions: String(1n << 34n) })).toBe(true)
    expect(canSetMatchTime({ permissions: String(1n << 33n) })).toBe(true)
    expect(canSetMatchTime({ permissions: '8' })).toBe(true)
    expect(canSetMatchTime({ permissions: String(1n << 13n) })).toBe(false)
    expect(canSetMatchTime({ permissions: '0' })).toBe(false)
    expect(canSetMatchTime(undefined)).toBe(false)
  })
})
