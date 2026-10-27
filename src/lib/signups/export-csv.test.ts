import { describe, expect, it } from 'vitest'

import { signupsToCsv, type ExportableSignup } from './export-csv'

function signup(overrides: Partial<ExportableSignup> = {}): ExportableSignup {
  return {
    display_name: 'Ginzburg',
    riot_tag: '001',
    discord_handle: 'ginz',
    score: 24.51,
    ...overrides,
  }
}

const rows = (csv: string) => csv.trimEnd().split('\r\n')

describe('signupsToCsv', () => {
  it('writes the player, discord and score columns', () => {
    expect(rows(signupsToCsv([signup()]))).toEqual([
      '"player","discord","score"',
      '"Ginzburg#001","ginz","24.51"',
    ])
  })

  it('leaves a missing score or discord blank', () => {
    const [, row] = rows(signupsToCsv([signup({ score: null, discord_handle: null })]))
    expect(row).toBe('"Ginzburg#001","",""')
  })

  it('escapes quotes and omits a missing tag', () => {
    const [, row] = rows(signupsToCsv([signup({ display_name: 'a "b"', riot_tag: null })]))
    expect(row.startsWith('"a ""b""","ginz"')).toBe(true)
  })
})
