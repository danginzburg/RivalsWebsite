import { describe, expect, it, vi } from 'vitest'
import { bestAccountGames, meetsGamesMinimum } from './comp-games'

const account = (riotId: string) => ({ riotId, puuid: riotId })

describe('bestAccountGames', () => {
  it('does not add games across accounts', async () => {
    const games = { main: 60, alt: 70 }
    const best = await bestAccountGames([account('main'), account('alt')], async (a) => {
      return games[a.riotId as keyof typeof games]
    })

    expect(best).toEqual({ games: 70, account: 'alt' })
    expect(meetsGamesMinimum(best.games)).toBe(false)
  })

  it('stops at the first account that qualifies', async () => {
    const lookup = vi.fn(async () => 100)
    const best = await bestAccountGames([account('main'), account('alt')], lookup)

    expect(best).toEqual({ games: 100, account: 'main' })
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('reports zero for an account with no competitive record', async () => {
    expect(await bestAccountGames([account('main')], async () => 0)).toEqual({
      games: 0,
      account: 'main',
    })
  })
})

describe('meetsGamesMinimum', () => {
  it('treats an unchecked player as not meeting it', () => {
    expect(meetsGamesMinimum(null)).toBe(false)
    expect(meetsGamesMinimum(99)).toBe(false)
    expect(meetsGamesMinimum(100)).toBe(true)
  })
})
