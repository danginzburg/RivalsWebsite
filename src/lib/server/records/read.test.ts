import { describe, expect, it } from 'vitest'

import { viewerIsTiedOff, withoutTieLists } from './read'

const context = { kills: 3, tied_off_profile_ids: ['p-1'], tied_off_puuids: ['puuid-2'] }
const listed = [{ holder: { id: 'p-top' }, puuid: 'puuid-top' }]

describe('viewerIsTiedOff', () => {
  it('finds a viewer among the cut-off ties by profile', () => {
    expect(viewerIsTiedOff(listed, context, { profileId: 'p-1', puuids: new Set() })).toBe(true)
  })

  it('finds them by a linked Riot account when the stat row was never linked', () => {
    expect(
      viewerIsTiedOff(listed, context, { profileId: 'p-9', puuids: new Set(['puuid-2']) })
    ).toBe(true)
  })

  it('is false for anyone else, and for a signed-out viewer', () => {
    expect(viewerIsTiedOff(listed, context, { profileId: 'p-9', puuids: new Set(['x']) })).toBe(
      false
    )
    expect(viewerIsTiedOff(listed, context, null)).toBe(false)
    expect(viewerIsTiedOff(listed, {}, { profileId: 'p-1', puuids: new Set() })).toBe(false)
  })
})

describe('viewerIsTiedOff for a viewer already on the list', () => {
  it('stays quiet when they are listed by profile', () => {
    const tiedAndListed = { ...context, tied_off_profile_ids: ['p-top'] }
    expect(viewerIsTiedOff(listed, tiedAndListed, { profileId: 'p-top', puuids: new Set() })).toBe(
      false
    )
  })

  it('stays quiet when they are listed under one of their Riot accounts', () => {
    expect(
      viewerIsTiedOff(listed, context, { profileId: 'p-1', puuids: new Set(['puuid-top']) })
    ).toBe(false)
  })
})

describe('withoutTieLists', () => {
  it('keeps who-is-tied out of what the browser gets', () => {
    expect(withoutTieLists(context)).toEqual({ kills: 3 })
  })
})
