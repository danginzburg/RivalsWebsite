import { describe, expect, it } from 'vitest'

import {
  planAccoladeSync,
  seasonContextLabel,
  type ExistingAssignment,
  type SeasonAward,
} from '$lib/server/accolades/season-plan'

const seasons = [
  { id: 's1', name: 'Season 1', code: 'rivals1' },
  { id: 's2', name: 'Season  2', code: 'rivals2' },
]

const award = (profileId: string, seasonId = 's1', accoladeId = 'gold'): SeasonAward => ({
  accoladeId,
  profileId,
  seasonId,
  context: seasonId === 's1' ? 'Season 1' : 'Season 2',
})

const row = (overrides: Partial<ExistingAssignment>): ExistingAssignment => ({
  id: 'row',
  accolade_id: 'gold',
  profile_id: 'p1',
  season_id: null,
  context: null,
  source: 'manual',
  ...overrides,
})

const scope = { seasonIds: ['s1', 's2'] }

describe('seasonContextLabel', () => {
  it('collapses stray spacing in the season name', () => {
    expect(seasonContextLabel(seasons[1]!)).toBe('Season 2')
  })
})

describe('planAccoladeSync', () => {
  it('adds awards nobody has yet', () => {
    const plan = planAccoladeSync({
      desired: [award('p1'), award('p2')],
      existing: [],
      dismissed: [],
      seasons,
      scope,
    })
    expect(plan.insert.map((a) => a.profileId)).toEqual(['p1', 'p2'])
    expect(plan.remove).toEqual([])
  })

  it('treats a hand-assigned award with a matching context as already given', () => {
    const plan = planAccoladeSync({
      desired: [award('p1', 's2')],
      existing: [row({ context: 'season 2' })],
      dismissed: [],
      seasons,
      scope,
    })
    expect(plan.insert).toEqual([])
  })

  it('does not count the same accolade from another season', () => {
    const plan = planAccoladeSync({
      desired: [award('p1', 's2')],
      existing: [row({ season_id: 's1' })],
      dismissed: [],
      seasons,
      scope,
    })
    expect(plan.insert).toHaveLength(1)
  })

  it('retracts automatic awards the results no longer back, never manual ones', () => {
    const plan = planAccoladeSync({
      desired: [],
      existing: [
        row({ id: 'auto', season_id: 's1', source: 'auto' }),
        row({ id: 'manual', season_id: 's1', source: 'manual' }),
      ],
      dismissed: [],
      seasons,
      scope,
    })
    expect(plan.remove.map((r) => r.id)).toEqual(['auto'])
  })

  it('leaves seasons and players outside the scope alone', () => {
    const plan = planAccoladeSync({
      desired: [award('p1', 's2'), award('p2', 's1')],
      existing: [
        row({ id: 'other-season', season_id: 's2', source: 'auto' }),
        row({ id: 'other-player', profile_id: 'p2', season_id: 's1', source: 'auto' }),
      ],
      dismissed: [],
      seasons,
      scope: { seasonIds: ['s1'], profileId: 'p1' },
    })
    expect(plan.insert).toEqual([])
    expect(plan.remove).toEqual([])
  })

  it('does not re-add an award an admin dismissed', () => {
    const plan = planAccoladeSync({
      desired: [award('p1')],
      existing: [],
      dismissed: [{ accolade_id: 'gold', profile_id: 'p1', season_id: 's1' }],
      seasons,
      scope,
    })
    expect(plan.insert).toEqual([])
  })
})
