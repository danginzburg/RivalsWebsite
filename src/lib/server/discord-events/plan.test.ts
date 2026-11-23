import { describe, expect, it } from 'vitest'
import {
  EventStatus,
  eventBodyForMatch,
  findMatchToAdopt,
  normalizeTwitchUrl,
  parseBestOf,
  parseMatchTitle,
  planLinked,
  shouldCreateEvent,
  snapshotAfterCreate,
  type DiscordEvent,
  type SyncMatch,
  type SyncTeam,
} from './plan'

const ORIGIN = 'https://rivals.example'
const NOW = new Date('2026-11-23T18:00:00.000Z')
const START = '2026-11-25T01:00:00.000Z'

const sentinels: SyncTeam = { id: 't1', name: 'Sentinels', tag: 'SEN' }
const cloud9: SyncTeam = { id: 't2', name: 'Cloud9', tag: 'C9' }
const teamLiquid: SyncTeam = { id: 't3', name: 'Team Liquid', tag: 'TL' }
const liquid: SyncTeam = { id: 't4', name: 'Liquid', tag: 'LQ' }

function match(partial: Partial<SyncMatch> = {}): SyncMatch {
  return {
    id: 'm1',
    status: 'scheduled',
    approval_status: 'approved',
    scheduled_at: START,
    best_of: 3,
    team_a: sentinels,
    team_b: cloud9,
    twitch_url: null,
    ...partial,
  }
}

/** The event the site would create for `m`, as Discord returns it. */
function eventFor(m: SyncMatch, partial: Partial<DiscordEvent> = {}): DiscordEvent {
  const body = eventBodyForMatch(m, ORIGIN)
  return {
    id: 'e1',
    guild_id: 'g1',
    name: body.name!,
    description: body.description,
    scheduled_start_time: body.scheduled_start_time!,
    scheduled_end_time: body.scheduled_end_time,
    status: EventStatus.Scheduled,
    entity_type: 3,
    entity_metadata: body.entity_metadata,
    creator_id: 'bot',
    ...partial,
  }
}

function synced(m: SyncMatch) {
  return snapshotAfterCreate(m, eventBodyForMatch(m, ORIGIN))
}

describe('eventBodyForMatch', () => {
  it('names the teams, links the match and runs an hour a map', () => {
    const body = eventBodyForMatch(match({ best_of: 5 }), ORIGIN)
    expect(body.name).toBe('Sentinels vs Cloud9')
    expect(body.scheduled_start_time).toBe(START)
    expect(body.scheduled_end_time).toBe('2026-11-25T06:00:00.000Z')
    expect(body.entity_type).toBe(3)
    expect(body.entity_metadata?.location).toBe(`${ORIGIN}/matches/m1`)
    expect(body.description).toContain(`${ORIGIN}/matches/m1`)
    expect(body.description).toContain('Best of 5')
  })

  it('puts the Twitch link in the location when there is one', () => {
    const body = eventBodyForMatch(match({ twitch_url: 'https://twitch.tv/tcrivals' }), ORIGIN)
    expect(body.entity_metadata?.location).toBe('https://twitch.tv/tcrivals')
  })
})

describe('normalizeTwitchUrl', () => {
  it('canonicalizes channel links', () => {
    expect(normalizeTwitchUrl('twitch.tv/TCRivals')).toBe('https://twitch.tv/tcrivals')
    expect(normalizeTwitchUrl('https://www.twitch.tv/tcrivals/')).toBe('https://twitch.tv/tcrivals')
    expect(normalizeTwitchUrl(' http://m.twitch.tv/tcrivals?x=1 ')).toBe(
      'https://twitch.tv/tcrivals'
    )
  })

  it('rejects anything else', () => {
    expect(normalizeTwitchUrl('https://youtube.com/@tcrivals')).toBeNull()
    expect(normalizeTwitchUrl(`${ORIGIN}/matches/m1`)).toBeNull()
    expect(normalizeTwitchUrl(null)).toBeNull()
  })
})

describe('shouldCreateEvent', () => {
  it('creates events for upcoming scheduled matches inside the window', () => {
    expect(shouldCreateEvent(match(), NOW)).toBe(true)
  })

  it('skips past, far-off, unscheduled, unapproved and finished matches', () => {
    expect(shouldCreateEvent(match({ scheduled_at: '2026-11-23T17:00:00Z' }), NOW)).toBe(false)
    expect(shouldCreateEvent(match({ scheduled_at: '2027-01-30T00:00:00Z' }), NOW)).toBe(false)
    expect(shouldCreateEvent(match({ scheduled_at: null }), NOW)).toBe(false)
    expect(shouldCreateEvent(match({ approval_status: 'pending' }), NOW)).toBe(false)
    expect(shouldCreateEvent(match({ status: 'completed' }), NOW)).toBe(false)
    expect(shouldCreateEvent(match({ status: 'cancelled' }), NOW)).toBe(false)
  })

  it('does not bring back an event closed at the same time, but does after a reschedule', () => {
    expect(shouldCreateEvent(match(), NOW, [START])).toBe(false)
    expect(shouldCreateEvent(match(), NOW, ['2026-11-24T01:00:00Z'])).toBe(true)
  })
})

describe('planLinked', () => {
  it('does nothing when neither side changed', () => {
    const m = match()
    const plan = planLinked({
      match: m,
      event: eventFor(m),
      snapshot: synced(m),
      now: NOW,
      origin: ORIGIN,
    })
    expect(plan.site).toEqual({})
    expect(plan.discord).toEqual({ type: 'none' })
    expect(plan.close).toBe(false)
  })

  it('moves the event when the site moves the match', () => {
    const before = match()
    const after = match({ scheduled_at: '2026-11-26T01:00:00.000Z' })
    const plan = planLinked({
      match: after,
      event: eventFor(before),
      snapshot: synced(before),
      now: NOW,
      origin: ORIGIN,
    })
    expect(plan.site).toEqual({})
    expect(plan.discord).toEqual({
      type: 'update',
      body: {
        scheduled_start_time: '2026-11-26T01:00:00.000Z',
        scheduled_end_time: '2026-11-26T04:00:00.000Z',
      },
    })
    expect(plan.snapshot.site_start).toBe('2026-11-26T01:00:00.000Z')
    expect(plan.snapshot.event_start).toBe('2026-11-26T01:00:00.000Z')
  })

  it('moves the match when Discord moves the event', () => {
    const m = match()
    const plan = planLinked({
      match: m,
      event: eventFor(m, { scheduled_start_time: '2026-11-25T02:30:00+00:00' }),
      snapshot: synced(m),
      now: NOW,
      origin: ORIGIN,
    })
    expect(plan.site).toEqual({ scheduledAt: '2026-11-25T02:30:00.000Z' })
    expect(plan.discord).toEqual({ type: 'none' })
    expect(plan.snapshot.site_start).toBe('2026-11-25T02:30:00.000Z')
    expect(plan.snapshot.event_start).toBe('2026-11-25T02:30:00.000Z')
  })

  it('lets Discord win when both sides moved the time', () => {
    const before = match()
    const plan = planLinked({
      match: match({ scheduled_at: '2026-11-26T01:00:00.000Z' }),
      event: eventFor(before, { scheduled_start_time: '2026-11-27T01:00:00.000Z' }),
      snapshot: synced(before),
      now: NOW,
      origin: ORIGIN,
    })
    expect(plan.site).toEqual({ scheduledAt: '2026-11-27T01:00:00.000Z' })
    expect(plan.discord).toEqual({ type: 'none' })
  })

  it('sets the event location when the site adds a Twitch link', () => {
    const before = match()
    const plan = planLinked({
      match: match({ twitch_url: 'https://twitch.tv/tcrivals' }),
      event: eventFor(before),
      snapshot: synced(before),
      now: NOW,
      origin: ORIGIN,
    })
    expect(plan.discord).toEqual({
      type: 'update',
      body: { entity_metadata: { location: 'https://twitch.tv/tcrivals' } },
    })
    expect(plan.snapshot.site_twitch_url).toBe('https://twitch.tv/tcrivals')
  })

  it('falls back to the match page when the site removes the Twitch link', () => {
    const before = match({ twitch_url: 'https://twitch.tv/tcrivals' })
    const plan = planLinked({
      match: match(),
      event: eventFor(before),
      snapshot: synced(before),
      now: NOW,
      origin: ORIGIN,
    })
    expect(plan.discord).toEqual({
      type: 'update',
      body: { entity_metadata: { location: `${ORIGIN}/matches/m1` } },
    })
  })

  it('takes a Twitch link set in Discord onto the match', () => {
    const m = match()
    const plan = planLinked({
      match: m,
      event: eventFor(m, { entity_metadata: { location: 'twitch.tv/OtherCaster' } }),
      snapshot: synced(m),
      now: NOW,
      origin: ORIGIN,
    })
    expect(plan.site).toEqual({ twitchUrl: 'https://twitch.tv/othercaster' })
    expect(plan.discord).toEqual({ type: 'none' })
    expect(plan.snapshot.site_twitch_url).toBe('https://twitch.tv/othercaster')
    expect(plan.snapshot.event_location).toBe('twitch.tv/OtherCaster')
  })

  it('removes the Twitch link when Discord replaces it with something else', () => {
    const m = match({ twitch_url: 'https://twitch.tv/tcrivals' })
    const plan = planLinked({
      match: m,
      event: eventFor(m, { entity_metadata: { location: 'Main stage' } }),
      snapshot: synced(m),
      now: NOW,
      origin: ORIGIN,
    })
    expect(plan.site).toEqual({ twitchUrl: null })
  })

  it('renames the event when the site changes a team', () => {
    const before = match()
    const plan = planLinked({
      match: match({ team_b: teamLiquid }),
      event: eventFor(before),
      snapshot: synced(before),
      now: NOW,
      origin: ORIGIN,
    })
    expect(plan.discord).toEqual({ type: 'update', body: { name: 'Sentinels vs Team Liquid' } })
  })

  it('leaves a renamed event alone when the teams did not change', () => {
    const m = match()
    const plan = planLinked({
      match: m,
      event: eventFor(m, { name: 'GRAND FINAL: SEN vs C9' }),
      snapshot: synced(m),
      now: NOW,
      origin: ORIGIN,
    })
    expect(plan.discord).toEqual({ type: 'none' })
  })

  it('deletes the event when the site cancels the match', () => {
    const before = match()
    const plan = planLinked({
      match: match({ status: 'cancelled' }),
      event: eventFor(before),
      snapshot: synced(before),
      now: NOW,
      origin: ORIGIN,
    })
    expect(plan.discord).toEqual({ type: 'delete' })
    expect(plan.close).toBe(true)
  })

  it('completes an event already under way when the match finishes', () => {
    const before = match()
    const plan = planLinked({
      match: match({ status: 'completed' }),
      event: eventFor(before, { status: EventStatus.Active }),
      snapshot: synced(before),
      now: NOW,
      origin: ORIGIN,
    })
    expect(plan.discord).toEqual({ type: 'update', body: { status: EventStatus.Completed } })
    expect(plan.close).toBe(true)
  })

  it('deletes the event when the match is deleted', () => {
    const m = match()
    const plan = planLinked({
      match: null,
      event: eventFor(m),
      snapshot: synced(m),
      now: NOW,
      origin: ORIGIN,
    })
    expect(plan.discord).toEqual({ type: 'delete' })
    expect(plan.close).toBe(true)
  })

  it('cancels the match when its event is deleted or cancelled in Discord before it starts', () => {
    const m = match()
    for (const event of [null, eventFor(m, { status: EventStatus.Canceled })]) {
      const plan = planLinked({ match: m, event, snapshot: synced(m), now: NOW, origin: ORIGIN })
      expect(plan.site).toEqual({ cancel: true })
      expect(plan.discord).toEqual({ type: 'none' })
      expect(plan.close).toBe(true)
    }
  })

  it('only unlinks when the event ended or vanished after its start', () => {
    const m = match()
    const completed = planLinked({
      match: m,
      event: eventFor(m, { status: EventStatus.Completed }),
      snapshot: synced(m),
      now: NOW,
      origin: ORIGIN,
    })
    expect(completed.site).toEqual({})
    expect(completed.close).toBe(true)

    const later = new Date('2026-11-25T05:00:00Z')
    const vanished = planLinked({
      match: m,
      event: null,
      snapshot: synced(m),
      now: later,
      origin: ORIGIN,
    })
    expect(vanished.site).toEqual({})
    expect(vanished.close).toBe(true)
  })

  it('does not move an event that is already live', () => {
    const before = match()
    const plan = planLinked({
      match: match({ status: 'live', scheduled_at: '2026-11-26T01:00:00.000Z' }),
      event: eventFor(before, { status: EventStatus.Active }),
      snapshot: synced(before),
      now: NOW,
      origin: ORIGIN,
    })
    expect(plan.discord).toEqual({ type: 'none' })
  })
})

describe('parseMatchTitle', () => {
  const teams = [sentinels, cloud9, teamLiquid, liquid]

  it('reads "A vs B" by name or tag, any case', () => {
    expect(parseMatchTitle('Sentinels vs Cloud9', teams)).toEqual([sentinels, cloud9])
    expect(parseMatchTitle('sen VS. c9', teams)).toEqual([sentinels, cloud9])
    expect(parseMatchTitle('Cloud9 v Sentinels', teams)).toEqual([cloud9, sentinels])
    expect(parseMatchTitle('SEN versus TL', teams)).toEqual([sentinels, teamLiquid])
  })

  it('allows a prefix before the first team and a suffix after the second', () => {
    expect(parseMatchTitle('Week 3: Sentinels vs Cloud9 (Bo3)', teams)).toEqual([sentinels, cloud9])
  })

  it('prefers the longest matching name', () => {
    expect(parseMatchTitle('Team Liquid vs Sentinels', teams)).toEqual([teamLiquid, sentinels])
    expect(parseMatchTitle('Sentinels vs Liquid', teams)).toEqual([sentinels, liquid])
  })

  it('returns null for titles that name no pair', () => {
    expect(parseMatchTitle('Movie night', teams)).toBeNull()
    expect(parseMatchTitle('Sentinels vs Nobody', teams)).toBeNull()
    expect(parseMatchTitle('Sentinels vs SEN', teams)).toBeNull()
    expect(parseMatchTitle('A vs B vs C', teams)).toBeNull()
  })
})

describe('parseBestOf', () => {
  it('reads Bo5 from the title or description', () => {
    expect(parseBestOf('SEN vs C9 Bo5')).toBe(5)
    expect(parseBestOf('SEN vs C9', 'Grand final, best of 5')).toBe(5)
    expect(parseBestOf('SEN vs C9 (Bo3)')).toBe(3)
    expect(parseBestOf('SEN vs C9', null)).toBe(3)
  })
})

describe('findMatchToAdopt', () => {
  it('finds the same pairing within half a day, either way round', () => {
    const event = eventFor(match(), { scheduled_start_time: '2026-11-25T03:00:00Z' })
    const flipped = match({ id: 'm2', team_a: cloud9, team_b: sentinels })
    const other = match({ id: 'm3', team_b: teamLiquid })
    expect(findMatchToAdopt(event, [sentinels, cloud9], [other, flipped])?.id).toBe('m2')
  })

  it('ignores the pairing on another day', () => {
    const event = eventFor(match(), { scheduled_start_time: '2026-11-27T01:00:00Z' })
    expect(findMatchToAdopt(event, [sentinels, cloud9], [match()])).toBeNull()
  })
})
