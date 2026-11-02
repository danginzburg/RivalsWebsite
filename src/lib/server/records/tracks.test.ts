import { describe, expect, it } from 'vitest'

import { buildRecordTracks } from './tracks'

const season = (code: string, is_active = false) => ({
  id: `id-${code}`,
  code,
  name: code,
  is_active,
})

describe('buildRecordTracks', () => {
  it('shows the side league while it is the active season, kept apart from Rivals', () => {
    const tracks = buildRecordTracks([season('rivals4'), season('rivals5'), season('shitq1', true)])
    expect(tracks.rivals.seasonIds).toEqual(['id-rivals5'])
    expect(tracks.sideLeague?.key).toBe('shitq1')
    expect(tracks.sideLeague?.seasonIds).toEqual(['id-shitq1'])
    expect(tracks.display.key).toBe('shitq1')
  })

  it('goes back to Rivals once the side league is no longer active', () => {
    const tracks = buildRecordTracks([season('rivals5', true), season('shitq1')])
    expect(tracks.sideLeague).toBeNull()
    expect(tracks.display.key).toBe('rivals')
  })

  it('never treats an older Rivals season as a side league', () => {
    const tracks = buildRecordTracks([season('rivals4', true)])
    expect(tracks.sideLeague).toBeNull()
    expect(tracks.display.key).toBe('rivals')
  })
})
