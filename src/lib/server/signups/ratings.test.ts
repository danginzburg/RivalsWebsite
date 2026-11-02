import { describe, expect, it, vi } from 'vitest'

vi.mock('$lib/supabase/admin', () => ({ supabaseAdmin: {} }))

const { pickRating, ratingNameKey } = await import('./ratings')

const sheet = new Map([
  ['tmidfire', { rating: 0.979, name: 'tmidfire' }],
  ['pupper', { rating: 1.238, name: 'Pupper' }],
  ['edieuniverse', { rating: 1.091, name: 'Edieuniverse' }],
])

describe('ratingNameKey', () => {
  it('ignores case, whitespace and a #tag', () => {
    expect(ratingNameKey('  Pupper#Kun ')).toBe('pupper')
  })
})

describe('pickRating', () => {
  it('matches the current Riot name', () => {
    const match = pickRating({ riotName: 'TMIDFIRE', knownNames: [], discordUsername: null }, sheet)
    expect(match).toMatchObject({ via: 'riot', rating: { rating: 0.979 } })
  })

  it('finds a renamed player through a name they used before', () => {
    const match = pickRating(
      { riotName: 'Pup', knownNames: ['Pup#Kun', 'Pupper'], discordUsername: null },
      sheet
    )
    expect(match).toMatchObject({ via: 'riot', rating: { name: 'Pupper' } })
  })

  it('prefers a known name over the Discord username', () => {
    const match = pickRating(
      { riotName: 'Pup', knownNames: ['Pupper'], discordUsername: 'edieuniverse' },
      sheet
    )
    expect(match).toMatchObject({ via: 'riot', rating: { name: 'Pupper' } })
  })

  it('falls back to the Discord username and says so', () => {
    const match = pickRating(
      { riotName: 'edie', knownNames: [], discordUsername: 'edieuniverse' },
      sheet
    )
    expect(match).toMatchObject({ via: 'discord', rating: { name: 'Edieuniverse' } })
  })

  it('finds nothing for a player who is not on the sheet', () => {
    const match = pickRating(
      { riotName: 'NepTon', knownNames: ['NepTon#BALLS'], discordUsername: 'nepton' },
      sheet
    )
    expect(match).toBeNull()
  })
})
