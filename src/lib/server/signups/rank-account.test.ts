import { describe, expect, it, vi } from 'vitest'
import type { RankLookup } from '$lib/server/riot/henrik'
import { pickSignupAccount, type RankTarget } from './rank-account'

const main: RankTarget = { riotId: 'main#NA1', puuid: 'p-main' }
const alt: RankTarget = { riotId: 'alt#NA1', puuid: 'p-alt' }
const alt2: RankTarget = { riotId: 'alt2#NA1', puuid: 'p-alt2' }

function found(currentRank: string, peakRank: string, gamesInWindow: number) {
  return {
    account: { name: '', tag: '', puuid: null },
    rank: { currentRank, peakRank, gamesInWindow },
  }
}

function lookups(table: Record<string, ReturnType<typeof found> | Error>) {
  return vi.fn(async (target: RankTarget) => {
    const result = table[String(target.riotId)]
    if (result instanceof Error) throw result
    return result as unknown as RankLookup
  })
}

const GOLD = ['Gold 1', 'Gold 1'] as const
const DIAMOND = ['Diamond 1', 'Diamond 1'] as const

describe('pickSignupAccount', () => {
  it('makes one lookup and no check without alts', async () => {
    const lookup = lookups({ 'main#NA1': found(...GOLD, 5) })
    const { check } = await pickSignupAccount(main, [], lookup)

    expect(check).toBeNull()
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('uses a main with 100 games, and still flags a higher alt', async () => {
    const { lookup, check } = await pickSignupAccount(
      main,
      [alt],
      lookups({ 'main#NA1': found(...GOLD, 100), 'alt#NA1': found(...DIAMOND, 300) })
    )

    expect(lookup.rank?.currentRank).toBe('Gold 1')
    expect(check?.usedRiotId).toBe('main#NA1')
    expect(check?.higherAlt).toBe('alt#NA1')
  })

  it('uses the best alt when the main is short of games, however few the alt has', async () => {
    const { lookup, check } = await pickSignupAccount(
      main,
      [alt, alt2],
      lookups({
        'main#NA1': found(...GOLD, 99),
        'alt#NA1': found('Platinum 1', 'Platinum 1', 150),
        'alt2#NA1': found(...DIAMOND, 3),
      })
    )

    expect(lookup.rank?.currentRank).toBe('Diamond 1')
    expect(check?.usedRiotId).toBe('alt2#NA1')
    expect(check?.higherAlt).toBe('alt2#NA1')
  })

  it('stays on a main short of games when no alt has a rank', async () => {
    const { check } = await pickSignupAccount(
      main,
      [alt],
      lookups({
        'main#NA1': found(...GOLD, 40),
        'alt#NA1': { account: found(...GOLD, 0).account, rank: null } as never,
      })
    )

    expect(check?.usedRiotId).toBe('main#NA1')
    expect(check?.higherAlt).toBeNull()
  })

  it('does not flag an alt that is level with or below the main', async () => {
    const { check } = await pickSignupAccount(
      main,
      [alt, alt2],
      lookups({
        'main#NA1': found(...DIAMOND, 200),
        'alt#NA1': found(...DIAMOND, 10),
        'alt2#NA1': found(...GOLD, 10),
      })
    )

    expect(check?.higherAlt).toBeNull()
  })

  it('leaves out an alt that cannot be looked up', async () => {
    const { check } = await pickSignupAccount(
      main,
      [alt],
      lookups({ 'main#NA1': found(...GOLD, 100), 'alt#NA1': new Error('not found') })
    )

    expect(check?.alts).toEqual([])
    expect(check?.usedRiotId).toBe('main#NA1')
  })

  it('passes a rate limit on an alt to the caller', async () => {
    const limited = Object.assign(new Error('slow down'), { status: 429 })

    await expect(
      pickSignupAccount(
        main,
        [alt],
        lookups({ 'main#NA1': found(...GOLD, 100), 'alt#NA1': limited })
      )
    ).rejects.toBe(limited)
  })
})
