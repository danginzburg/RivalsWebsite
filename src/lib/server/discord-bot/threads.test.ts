import { describe, expect, it } from 'vitest'
import {
  filterMatchChoices,
  matchChoiceLabel,
  pickMatchForThread,
  shouldSaveVeto,
  vetoFromMessages,
  type ThreadMatch,
} from './threads'

const NOW = new Date('2026-11-23T18:00:00Z')
const sen = { id: 't1', name: 'Sentinels' }
const c9 = { id: 't2', name: 'Cloud9' }
const tl = { id: 't3', name: 'Team Liquid' }

function match(partial: Partial<ThreadMatch>): ThreadMatch {
  return {
    id: 'm1',
    status: 'scheduled',
    scheduled_at: '2026-11-25T01:00:00Z',
    team_a: sen,
    team_b: c9,
    ...partial,
  }
}

describe('pickMatchForThread', () => {
  it('picks the pairing’s soonest open match, either way round', () => {
    const later = match({ id: 'later', scheduled_at: '2026-12-02T01:00:00Z' })
    const sooner = match({ id: 'sooner', team_a: c9, team_b: sen })
    const other = match({ id: 'other', team_b: tl })
    expect(pickMatchForThread([sen, c9], [later, other, sooner], new Set(), NOW)?.id).toBe('sooner')
  })

  it('takes an unscheduled match when nothing has a time', () => {
    const unscheduled = match({ id: 'u', scheduled_at: null })
    expect(pickMatchForThread([sen, c9], [unscheduled], new Set(), NOW)?.id).toBe('u')
  })

  it('prefers a scheduled match over an unscheduled one', () => {
    const unscheduled = match({ id: 'u', scheduled_at: null })
    const scheduled = match({ id: 's' })
    expect(pickMatchForThread([sen, c9], [unscheduled, scheduled], new Set(), NOW)?.id).toBe('s')
  })

  it('skips finished, cancelled, stale and already-claimed matches', () => {
    const candidates = [
      match({ id: 'done', status: 'completed' }),
      match({ id: 'off', status: 'cancelled' }),
      match({ id: 'stale', scheduled_at: '2026-11-20T01:00:00Z' }),
      match({ id: 'claimed' }),
    ]
    expect(pickMatchForThread([sen, c9], candidates, new Set(['claimed']), NOW)).toBeNull()
  })
})

const LOG = [
  '25. Oct.2026 23:06:23 UTC: Team 1 (SEN) bans Map "Sunset"!',
  '25. Oct.2026 23:06:40 UTC: Team 2 (C9) bans Map "Haven"!',
  '25. Oct.2026 23:07:02 UTC: Team 1 (SEN) picks Map "Ascent"!',
  '25. Oct.2026 23:07:30 UTC: Team 2 (C9) picked "Attacker" as Side to start on Map "Ascent"!',
  '25. Oct.2026 23:08:10 UTC: Map "Lotus" will be decider!',
]
const VETO = [
  'SEN bans Sunset',
  'C9 bans Haven',
  'SEN picks Ascent · C9 starts Attacker',
  'Lotus decider',
]

describe('vetoFromMessages', () => {
  it('reads a pasted log and ignores the chat around it', () => {
    const messages = [
      { id: '1', content: 'gl hf' },
      { id: '2', content: `veto done:\n${LOG.join('\n')}\nsee you then` },
    ]
    expect(vetoFromMessages(messages)).toEqual(VETO)
  })

  it('reads a log inside a code block or quote', () => {
    expect(vetoFromMessages([{ id: '1', content: '```\n' + LOG.join('\n') + '\n```' }])).toEqual(
      VETO
    )
    expect(vetoFromMessages([{ id: '1', content: LOG.map((l) => `> ${l}`).join('\n') }])).toEqual(
      VETO
    )
  })

  it('joins a log split across messages and counts a repeated paste once', () => {
    const messages = [
      { id: '1', content: LOG.slice(0, 2).join('\n') },
      { id: '2', content: LOG.slice(2).join('\n') },
      { id: '3', content: LOG.join('\n') },
    ]
    expect(vetoFromMessages(messages)).toEqual(VETO)
  })

  it('reads embeds too', () => {
    expect(vetoFromMessages([{ id: '1', embeds: [{ description: LOG.join('\n') }] }])).toEqual(VETO)
  })

  it('is empty when there is no log', () => {
    expect(vetoFromMessages([{ id: '1', content: 'we ban haven lol' }])).toEqual([])
  })
})

describe('shouldSaveVeto', () => {
  it('saves onto a match with no veto', () => {
    expect(shouldSaveVeto({ current: [], lastImported: null, next: VETO })).toBe(true)
    expect(shouldSaveVeto({ current: null, lastImported: null, next: VETO })).toBe(true)
  })

  it('updates a veto it imported before', () => {
    const before = VETO.slice(0, 2)
    expect(shouldSaveVeto({ current: before, lastImported: before, next: VETO })).toBe(true)
  })

  it('leaves a veto an admin entered on the site', () => {
    expect(shouldSaveVeto({ current: ['typed by admin'], lastImported: null, next: VETO })).toBe(
      false
    )
  })

  it('does nothing when nothing changed or there is no log', () => {
    expect(shouldSaveVeto({ current: VETO, lastImported: VETO, next: VETO })).toBe(false)
    expect(shouldSaveVeto({ current: [], lastImported: null, next: [] })).toBe(false)
  })
})

describe('match choices', () => {
  it('labels a match with its Central time', () => {
    expect(matchChoiceLabel(match({}))).toBe('Sentinels vs Cloud9 · Tue, Nov 24, 7:00 PM CT')
    expect(matchChoiceLabel(match({ scheduled_at: null }))).toBe(
      'Sentinels vs Cloud9 · not scheduled yet'
    )
  })

  it('filters by words of the team names', () => {
    const matches = [match({ id: 'a' }), match({ id: 'b', team_b: tl })]
    expect(filterMatchChoices(matches, 'liquid sen').map((m) => m.id)).toEqual(['b'])
    expect(filterMatchChoices(matches, '').map((m) => m.id)).toEqual(['a', 'b'])
  })
})
