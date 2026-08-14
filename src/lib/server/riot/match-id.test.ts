import { describe, expect, it } from 'vitest'
import { parseMatchId, parseMatchIdList } from './match-id'

const MATCH_ID = '733d62ab-b0b7-41e1-b873-ed4bbd91c39c'
const OTHER_ID = '2bdca1ec-7a19-421a-b8bc-2a0833ed8d9a'

describe('parseMatchId', () => {
  it('accepts a bare match id', () => {
    expect(parseMatchId(MATCH_ID)).toBe(MATCH_ID)
  })

  it('lowercases so ids compare equal regardless of how they were pasted', () => {
    expect(parseMatchId(MATCH_ID.toUpperCase())).toBe(MATCH_ID)
  })

  it('pulls the id out of a tracker.gg match URL', () => {
    expect(parseMatchId(`https://tracker.gg/valorant/match/${MATCH_ID}`)).toBe(MATCH_ID)
  })

  it('takes the last id when a URL carries a profile id as well', () => {
    expect(
      parseMatchId(`https://tracker.gg/valorant/profile/riot/${OTHER_ID}/matches/${MATCH_ID}`)
    ).toBe(MATCH_ID)
  })

  it('tolerates a query string and trailing slash', () => {
    expect(parseMatchId(`https://tracker.gg/valorant/match/${MATCH_ID}/?ref=overview`)).toBe(
      MATCH_ID
    )
  })

  it('returns null for input with no id in it', () => {
    expect(parseMatchId('https://tracker.gg/valorant')).toBeNull()
    expect(parseMatchId('not a match')).toBeNull()
    expect(parseMatchId('')).toBeNull()
  })
})

describe('parseMatchIdList', () => {
  it('splits on whitespace, newlines and commas', () => {
    const { ids } = parseMatchIdList(`${MATCH_ID}\n${OTHER_ID}, ${MATCH_ID.toUpperCase()}`)
    // Third entry is a duplicate of the first once lowercased.
    expect(ids).toEqual([MATCH_ID, OTHER_ID])
  })

  it('keeps paste order so a series keeps its map order', () => {
    const { ids } = parseMatchIdList(`${OTHER_ID} ${MATCH_ID}`)
    expect(ids).toEqual([OTHER_ID, MATCH_ID])
  })

  it('reports entries it could not read rather than dropping them silently', () => {
    const { ids, unparsed } = parseMatchIdList(`${MATCH_ID}\nhttps://tracker.gg/valorant\ngarbage`)
    expect(ids).toEqual([MATCH_ID])
    expect(unparsed).toEqual(['https://tracker.gg/valorant', 'garbage'])
  })

  it('returns nothing for empty input', () => {
    expect(parseMatchIdList('   \n  ')).toEqual({ ids: [], unparsed: [] })
  })
})
