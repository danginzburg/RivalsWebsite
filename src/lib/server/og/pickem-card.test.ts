import { describe, expect, it, vi } from 'vitest'

vi.mock('$lib/supabase/admin', () => ({ supabaseAdmin: {} }))

import { buildPickemFinalCard, topOfBoard, type PickemFinalEntry } from './pickem-card'

const entry = (rank: number, name = `p${rank}`): PickemFinalEntry => ({
  rank,
  name,
  score: 50 - rank,
})

describe('topOfBoard', () => {
  it('keeps everyone when five or fewer played', () => {
    expect(topOfBoard([entry(1), entry(2)])).toHaveLength(2)
  })

  it('shows the top five plus anyone tied with fifth, up to eight', () => {
    const ranked = [entry(1), entry(2), entry(3), entry(4), entry(5, 'a'), entry(5, 'b'), entry(7)]
    expect(topOfBoard(ranked).map((e) => e.name)).toEqual(['p1', 'p2', 'p3', 'p4', 'a', 'b'])
    const crowd = Array.from({ length: 12 }, (_, i) => entry(5, `t${i}`))
    expect(topOfBoard(crowd)).toHaveLength(8)
  })
})

describe('buildPickemFinalCard', () => {
  const base = {
    eventId: 'e',
    seasonId: 's',
    seasonCode: 's5',
    seasonName: 'Season 5',
    title: 'Season 5 Pick’em',
    status: 'scored',
    players: 9,
  }

  it('labels co-champions and lists the board', () => {
    const board = [entry(1, 'alice'), entry(1, 'bob'), entry(3, 'cara')]
    const tree = JSON.stringify(
      buildPickemFinalCard({ ...base, winners: board.slice(0, 2), board })
    )
    expect(tree).toContain('CO-CHAMPIONS')
    expect(tree).toContain('cara')
  })

  it('says so when nobody scored', () => {
    const tree = JSON.stringify(buildPickemFinalCard({ ...base, winners: [], board: [] }))
    expect(tree).toContain('No picks scored any points.')
  })
})
