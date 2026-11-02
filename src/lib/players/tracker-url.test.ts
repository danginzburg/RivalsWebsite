import { describe, expect, it } from 'vitest'
import {
  newRiotIdsFromTrackerLinks,
  riotIdFromTrackerUrl,
  riotIdKey,
  trackerProfileUrl,
} from './tracker-url'

describe('riotIdFromTrackerUrl', () => {
  it('reads the URL this site builds', () => {
    expect(riotIdFromTrackerUrl(trackerProfileUrl('some name', 'NA1')!)).toEqual({
      name: 'some name',
      tag: 'NA1',
    })
  })

  it('reads a URL without www or a trailing page', () => {
    expect(riotIdFromTrackerUrl('https://tracker.gg/valorant/profile/riot/alt%23EUW')).toEqual({
      name: 'alt',
      tag: 'EUW',
    })
  })

  it('reads a bare # from the fragment', () => {
    expect(
      riotIdFromTrackerUrl('https://tracker.gg/valorant/profile/riot/alt#NA1/overview')
    ).toEqual({ name: 'alt', tag: 'NA1' })
  })

  it('ignores anything that is not a tracker.gg Valorant profile', () => {
    expect(riotIdFromTrackerUrl('https://op.gg/valorant/profile/riot/alt%23NA1')).toBeNull()
    expect(riotIdFromTrackerUrl('https://tracker.gg/apex/profile/riot/alt%23NA1')).toBeNull()
    expect(riotIdFromTrackerUrl('https://tracker.gg/valorant/profile/riot/noTag')).toBeNull()
    expect(riotIdFromTrackerUrl('not a url')).toBeNull()
  })
})

describe('newRiotIdsFromTrackerLinks', () => {
  const link = (name: string, tag: string) => ({ url: trackerProfileUrl(name, tag)! })

  it('skips known accounts regardless of case', () => {
    expect(
      newRiotIdsFromTrackerLinks(
        [link('MAIN', 'na1'), link('alt', 'NA1')],
        [riotIdKey('main', 'NA1')]
      )
    ).toEqual([{ name: 'alt', tag: 'NA1' }])
  })

  it('returns a repeated link once and ignores other sites', () => {
    expect(
      newRiotIdsFromTrackerLinks(
        [link('alt', 'NA1'), link('Alt', 'na1'), { url: 'https://op.gg/alt' }],
        []
      )
    ).toEqual([{ name: 'alt', tag: 'NA1' }])
  })
})
