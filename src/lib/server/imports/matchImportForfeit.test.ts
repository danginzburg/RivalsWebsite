import { describe, expect, it } from 'vitest'
import {
  parseMapNotes,
  parseOptionalUuid,
  resolveAdminAwardForfeit,
  winnerFromMapSeriesScore,
} from './matchImportForfeit'

const teamA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const teamB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('winnerFromMapSeriesScore', () => {
  it('returns team A when A has more map wins', () => {
    expect(winnerFromMapSeriesScore(2, 1, teamA, teamB)).toBe(teamA)
  })
  it('returns team B when B has more map wins', () => {
    expect(winnerFromMapSeriesScore(1, 2, teamA, teamB)).toBe(teamB)
  })
  it('returns null on tie', () => {
    expect(winnerFromMapSeriesScore(1, 1, teamA, teamB)).toBeNull()
  })
})

describe('parseOptionalUuid', () => {
  it('accepts valid uuid', () => {
    expect(parseOptionalUuid(teamA)).toBe(teamA)
  })
  it('returns null for invalid', () => {
    expect(parseOptionalUuid('not-a-uuid')).toBeNull()
  })
})

describe('parseMapNotes', () => {
  it('filters empty strings', () => {
    expect(parseMapNotes({ '1': 'a', '2': '  ' })).toEqual({ '1': 'a' })
  })
})

describe('resolveAdminAwardForfeit', () => {
  it('uses map winner when no official override', () => {
    const r = resolveAdminAwardForfeit({
      mapWinnerTeamId: teamA,
      officialWinnerTeamId: null,
      forfeitingTeamId: null,
      teamAId: teamA,
      teamBId: teamB,
      reason: null,
      mapNotes: null,
      mapCount: 2,
    })
    expect(r.winnerTeamId).toBe(teamA)
    expect(r.matchForfeit).toBeNull()
    expect(r.perMapForfeitMeta.size).toBe(0)
  })

  it('overrides winner and sets admin_award when official differs from map', () => {
    const r = resolveAdminAwardForfeit({
      mapWinnerTeamId: teamA,
      officialWinnerTeamId: teamB,
      forfeitingTeamId: null,
      teamAId: teamA,
      teamBId: teamB,
      reason: 'rules',
      mapNotes: { '1': 'Map 1 note' },
      mapCount: 2,
    })
    expect(r.winnerTeamId).toBe(teamB)
    expect(r.matchForfeit?.kind).toBe('admin_award')
    expect(r.matchForfeit?.forfeiting_team_id).toBe(teamA)
    expect(r.matchForfeit?.reason).toBe('rules')
    expect(r.perMapForfeitMeta.get(1)?.label).toBe('Map 1 note')
  })

  it('throws when forfeitingTeamId conflicts with map winner', () => {
    expect(() =>
      resolveAdminAwardForfeit({
        mapWinnerTeamId: teamA,
        officialWinnerTeamId: teamB,
        forfeitingTeamId: teamB,
        teamAId: teamA,
        teamBId: teamB,
        reason: null,
        mapNotes: null,
        mapCount: 1,
      })
    ).toThrow()
  })
})
