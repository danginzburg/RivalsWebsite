import { describe, expect, it } from 'vitest'
import {
  adminAlertPayload,
  discordTimestamp,
  escapeMarkdown,
  leagueDate,
  leagueDayEnd,
  matchCancelledPayload,
  matchReminderPayload,
  matchResultPayload,
  matchScheduledPayload,
  pickemLockWarningPayload,
  pickemLockedPayload,
  pickemOpenedPayload,
  pickemFinalPayload,
  streamAddedPayload,
  streamEndedPayload,
  streamLivePayload,
  teamLogoPayload,
  vodPayload,
  vodStageLine,
  withRolePing,
  type MatchRef,
} from './embeds'
import type { DiscordEmbed, WebhookPayload } from './webhook'

const SITE = 'https://rivals.test'
// 2026-05-08T01:00:00Z = Thu May 7, 8:00 PM CT
const START = '2026-05-08T01:00:00.000Z'
const UNIX = Math.floor(Date.parse(START) / 1000)

const match: MatchRef = {
  matchId: 'm-1',
  siteUrl: SITE,
  teamA: { name: 'Jolly Rancher Boys', tag: 'JRB' },
  teamB: { name: 'Project 30', tag: 'P30' },
  event: 'Season 5 · Play-ins R2',
  scheduledAt: START,
  bestOf: 3,
}

const embed = (p: WebhookPayload) => (p.embeds ?? [])[0] as Required<DiscordEmbed>

describe('formatting helpers', () => {
  it('builds Discord timestamps', () => {
    expect(discordTimestamp(START, 'F')).toBe(`<t:${UNIX}:F>`)
    expect(discordTimestamp(START, 'R')).toBe(`<t:${UNIX}:R>`)
    expect(discordTimestamp(null)).toBeNull()
    expect(discordTimestamp('not a date')).toBeNull()
  })

  it('escapes markdown in names', () => {
    expect(escapeMarkdown('__init__ *bold*')).toBe('\\_\\_init\\_\\_ \\*bold\\*')
    expect(escapeMarkdown('Team-X (NA)')).toBe('Team-X (NA)')
  })

  it('formats the league date on Central time', () => {
    expect(leagueDate(START)).toBe('05/07/2026')
  })

  it('ends the league day at midnight Central, across daylight saving', () => {
    // 10 AM Eastern runs: 15:00 UTC in winter (CST, UTC-6) and summer (CDT, UTC-5).
    expect(leagueDayEnd(new Date('2026-11-23T15:00:00Z')).toISOString()).toBe(
      '2026-11-24T06:00:00.000Z'
    )
    expect(leagueDayEnd(new Date('2026-05-07T15:00:00Z')).toISOString()).toBe(
      '2026-05-08T05:00:00.000Z'
    )
    // 11:30 PM Central is still the same league day.
    expect(leagueDayEnd(new Date('2026-11-24T05:30:00Z')).toISOString()).toBe(
      '2026-11-24T06:00:00.000Z'
    )
  })

  it('joins the stage and designation without repeating the stage', () => {
    expect(vodStageLine('Play-ins', 'R2')).toBe('Play-ins R2')
    expect(vodStageLine('Play-ins', 'Play-ins R2')).toBe('Play-ins R2')
    expect(vodStageLine('Playoffs', null)).toBe('Playoffs')
    expect(vodStageLine(null, 'Grand Final')).toBe('Grand Final')
    expect(vodStageLine(null, null)).toBeNull()
  })
})

describe('match scheduled', () => {
  it('shows both teams, full and relative timestamps, and links to the match', () => {
    const e = embed(matchScheduledPayload(match))
    expect(e.title).toBe('Scheduled: Jolly Rancher Boys vs Project 30')
    expect(e.url).toBe(`${SITE}/matches/m-1`)
    expect(e.description).toContain('Jolly Rancher Boys (JRB) vs Project 30 (P30)')
    expect(e.description).toContain(`<t:${UNIX}:F>`)
    expect(e.description).toContain(`<t:${UNIX}:R>`)
    expect(e.fields).toEqual([{ name: 'Format', value: 'Best of 3', inline: true }])
    expect(e.footer.text).toContain('Play-ins R2')
  })

  it('marks a reschedule and copes with no time', () => {
    expect(embed(matchScheduledPayload({ ...match, rescheduled: true })).title).toMatch(
      /^Rescheduled:/
    )
    expect(embed(matchScheduledPayload({ ...match, scheduledAt: null })).description).toContain(
      'Time to be decided'
    )
  })

  it('never pings anyone', () => {
    expect(matchScheduledPayload(match).allowed_mentions).toEqual({ parse: [] })
  })

  it('builds the match-day reminder', () => {
    const e = embed(matchReminderPayload(match))
    expect(e.title).toBe('Match day: Jolly Rancher Boys vs Project 30')
    expect(e.description).toContain(`You play today at <t:${UNIX}:t> (<t:${UNIX}:R>).`)
  })
})

describe('match cancelled', () => {
  it('says the match was cancelled and when it was due', () => {
    const e = embed(matchCancelledPayload(match))
    expect(e.title).toBe('Cancelled: Jolly Rancher Boys vs Project 30')
    expect(e.description).toContain(`Was scheduled for <t:${UNIX}:F>.`)
    expect(e.description).toContain('cancelled')
  })
})

describe('match result', () => {
  const result = {
    ...match,
    scoreA: 2,
    scoreB: 1,
    winner: 'a' as const,
    maps: [
      { name: 'Ascent', a: 13, b: 9 },
      { name: 'Bind', a: 10, b: 13 },
      { name: 'Haven', a: 13, b: 11 },
    ],
    mvp: { name: 'Shooter', acs: 287.4, agent: 'Jett' },
    cardVersion: 'completed-2-1',
  }

  it('shows the score, a field per map and the MVP', () => {
    const e = embed(matchResultPayload(result))
    expect(e.title).toBe('Jolly Rancher Boys win 2–1')
    expect(e.description).toBe('**Jolly Rancher Boys 2** – 1 Project 30')
    expect(e.fields.slice(0, 3)).toEqual([
      { name: 'Map 1 · Ascent', value: '13 – 9', inline: true },
      { name: 'Map 2 · Bind', value: '10 – 13', inline: true },
      { name: 'Map 3 · Haven', value: '13 – 11', inline: true },
    ])
    expect(e.fields[3]).toEqual({ name: 'MVP', value: 'Shooter (Jett · 287 ACS)', inline: false })
  })

  it('uses the generated match card as the image, versioned by result', () => {
    expect(embed(matchResultPayload(result)).image.url).toBe(
      `${SITE}/og/match/m-1.png?v=completed-2-1`
    )
  })

  it('bolds team B when they win, and leaves out unknown MVPs and maps', () => {
    const e = embed(
      matchResultPayload({ ...result, scoreA: 0, scoreB: 2, winner: 'b', maps: [], mvp: null })
    )
    expect(e.title).toBe('Project 30 win 2–0')
    expect(e.description).toBe('Jolly Rancher Boys 0 – **2 Project 30**')
    expect(e.fields).toBeUndefined()
  })
})

describe('vods', () => {
  it('matches the #vods house format', () => {
    const p = vodPayload({
      teamA: match.teamA,
      teamB: match.teamB,
      stageLine: 'Play-ins R2',
      scheduledAt: START,
      vodUrl: 'https://www.youtube.com/watch?v=AoIM5t8NNw4',
    })
    expect(p.content).toBe(
      'JRB vs P30\nPlay-ins R2\n05/07/2026\nhttps://www.youtube.com/watch?v=AoIM5t8NNw4'
    )
    expect(p.embeds).toBeUndefined()
  })
})

describe('streams', () => {
  const stream = {
    ...match,
    platform: 'twitch',
    streamUrl: 'https://twitch.tv/tcrivals',
    displayName: 'TC Rivals',
  }

  it('announces a stream link being added', () => {
    const e = embed(streamAddedPayload(stream))
    expect(e.title).toBe('Stream added: Jolly Rancher Boys vs Project 30')
    expect(e.url).toBe('https://twitch.tv/tcrivals')
    expect(e.description).toContain('TC Rivals on Twitch')
    expect(e.description).toContain(`${SITE}/matches/m-1`)
  })

  it('pings the stream role when going live', () => {
    const p = streamLivePayload(stream, '123456')
    expect(p.content).toMatch(/^<@&123456> /)
    expect(p.allowed_mentions).toEqual({ parse: [], roles: ['123456'] })
    expect(embed(p).title).toBe('LIVE: Jolly Rancher Boys vs Project 30')
  })

  it('goes live without a ping when no role is set, and ends quietly', () => {
    expect(streamLivePayload(stream).allowed_mentions).toEqual({ parse: [] })
    const ended = streamEndedPayload(stream)
    expect(ended.content).not.toContain('<@&')
    expect(embed(ended).title).toMatch(/^Ended:/)
  })
})

describe('team logos', () => {
  it('shows name, tag and the logo', () => {
    const e = embed(
      teamLogoPayload({
        name: 'Project 30',
        tag: 'P30',
        logoUrl: 'https://cdn.test/p30.png',
        seasonName: 'Season 5',
        teamUrl: `${SITE}/teams/t-1`,
      })
    )
    expect(e.title).toBe('Project 30 [P30]')
    expect(e.image).toEqual({ url: 'https://cdn.test/p30.png' })
    expect(e.fields).toEqual([
      { name: 'Team', value: 'Project 30', inline: true },
      { name: 'Tag', value: 'P30', inline: true },
    ])
  })
})

describe("pick'ems", () => {
  const ref = { siteUrl: SITE, seasonCode: 's5', title: 'Season 5 Pick’em', lockAt: START }

  it('opens with the lock time', () => {
    const e = embed(pickemOpenedPayload(ref))
    expect(e.title).toBe('Season 5 Pick’em is open')
    expect(e.url).toBe(`${SITE}/pickems/s5`)
    expect(e.description).toContain(`<t:${UNIX}:F>`)
  })

  it('warns before locking and says when it locked', () => {
    const warning = embed(pickemLockWarningPayload(ref))
    expect(warning.title).toBe('Season 5 Pick’em locks today')
    expect(warning.description).toContain(`Picks lock today at <t:${UNIX}:t>`)
    expect(embed(pickemLockedPayload(ref)).title).toBe('Season 5 Pick’em is locked')
  })

  it('names the winner and the podium', () => {
    const e = embed(
      pickemFinalPayload({
        ...ref,
        board: [
          { name: 'alice', score: 42, rank: 1 },
          { name: 'bob', score: 40, rank: 2 },
          { name: 'cara', score: 31, rank: 3 },
        ],
      })
    )
    expect(e.title).toBe('alice wins the Season 5 Pick’em!')
    expect(e.description).toContain('🥇 alice · 42 pts')
    expect(e.description).toContain('🥉 cara · 31 pts')
    expect(e.image).toBeUndefined()
  })

  it('shows the standings card and numbers ranks past the podium', () => {
    const e = embed(
      pickemFinalPayload({
        ...ref,
        imageUrl: `${SITE}/og/pickem/e-1.png?v=1`,
        board: [
          { name: 'alice', score: 42, rank: 1 },
          { name: 'bob', score: 40, rank: 2 },
          { name: 'cara', score: 31, rank: 3 },
          { name: 'dev', score: 30, rank: 4 },
          { name: 'eve', score: 12, rank: 5 },
        ],
      })
    )
    expect(e.image).toEqual({ url: `${SITE}/og/pickem/e-1.png?v=1` })
    expect(e.description).toContain('**5.** eve · 12 pts')
  })

  it('handles a tie for first', () => {
    const e = embed(
      pickemFinalPayload({
        ...ref,
        board: [
          { name: 'alice', score: 42, rank: 1 },
          { name: 'bob', score: 42, rank: 1 },
        ],
      })
    )
    expect(e.title).toBe('alice & bob win the Season 5 Pick’em!')
  })
})

describe('role pings', () => {
  it('puts the role mention above an embed and allows only that role', () => {
    const p = withRolePing(
      pickemOpenedPayload({ siteUrl: SITE, seasonCode: 's5', title: 'P', lockAt: null }),
      '42'
    )
    expect(p.content).toBe('<@&42>')
    expect(p.allowed_mentions).toEqual({ parse: [], roles: ['42'] })
    expect(p.embeds).toHaveLength(1)
  })

  it('keeps existing content and roles, and does nothing without a role', () => {
    const live = streamLivePayload(
      { ...match, platform: 'twitch', streamUrl: 'https://twitch.tv/x', displayName: null },
      '7'
    )
    const both = withRolePing(live, '42')
    expect(both.content?.startsWith('<@&42> <@&7> ')).toBe(true)
    expect(both.allowed_mentions?.roles).toEqual(['7', '42'])
    expect(withRolePing(live, null)).toBe(live)
    expect(withRolePing(withRolePing(live, '7'), '7').content).toBe(live.content)
  })
})

describe('admin alerts', () => {
  it('links bug reports to moderation', () => {
    const e = embed(
      adminAlertPayload(
        { kind: 'bug_report', reporter: 'dan', pagePath: '/matches/m-1', description: 'Broken' },
        SITE
      )
    )
    expect(e.title).toBe('New bug report')
    expect(e.url).toBe(`${SITE}/admin?tab=moderation`)
    expect(e.fields).toEqual([{ name: 'Page', value: `${SITE}/matches/m-1` }])
    expect(e.footer.text).toBe('Reported by dan')
  })

  it('lists the review reasons for a captain report', () => {
    const e = embed(
      adminAlertPayload(
        {
          kind: 'match_report',
          submitter: 'cap',
          matchId: 'm-1',
          matchLabel: 'JRB vs P30',
          reasons: ['Score mismatch'],
        },
        SITE
      )
    )
    expect(e.title).toBe('Captain result needs review: JRB vs P30')
    expect(e.description).toBe('• Score mismatch')
    expect(e.url).toBe(`${SITE}/admin/matches-import`)
  })

  it('quotes the reported comment', () => {
    const e = embed(
      adminAlertPayload(
        { kind: 'comment_report', reporter: null, reason: 'spam', excerpt: 'buy now\nlink' },
        SITE
      )
    )
    expect(e.description).toBe('> buy now\n> link\nReason: spam')
  })

  it('truncates long text', () => {
    const e = embed(
      adminAlertPayload(
        { kind: 'bug_report', reporter: null, pagePath: null, description: 'x'.repeat(5000) },
        SITE
      )
    )
    expect(e.description.length).toBe(1500)
  })
})
