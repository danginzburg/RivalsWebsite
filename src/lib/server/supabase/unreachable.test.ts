import { describe, expect, it } from 'vitest'

import { isUnreachableError } from './unreachable'

describe('isUnreachableError', () => {
  it('recognises an undici connect timeout', () => {
    expect(
      isUnreachableError({
        message: 'TypeError: fetch failed',
        details:
          'TypeError: fetch failed\n\nCaused by: ConnectTimeoutError: Connect Timeout Error (UND_ERR_CONNECT_TIMEOUT)',
        hint: '',
        code: '',
      })
    ).toBe(true)
  })

  it('recognises other transport failures', () => {
    for (const message of [
      'fetch failed',
      'ECONNREFUSED 127.0.0.1:443',
      'getaddrinfo ENOTFOUND db.example.com',
      'socket hang up',
    ]) {
      expect(isUnreachableError({ message, code: '' })).toBe(true)
    }
  })

  it('does not treat a Postgres error as unreachable', () => {
    expect(
      isUnreachableError({
        code: 'PGRST200',
        message: "Could not find a relationship between 'seasons' and 'teams'",
        details: null,
      })
    ).toBe(false)
  })

  it('does not treat a missing-table error as unreachable', () => {
    expect(
      isUnreachableError({
        code: '42P01',
        message: 'relation "public.nope" does not exist',
      })
    ).toBe(false)
  })

  it('is false for null, undefined, and non-objects', () => {
    expect(isUnreachableError(null)).toBe(false)
    expect(isUnreachableError(undefined)).toBe(false)
    expect(isUnreachableError('fetch failed')).toBe(false)
  })

  it('is false for an unrelated error with no code', () => {
    expect(isUnreachableError({ message: 'row level security violation', code: '' })).toBe(false)
  })
})
