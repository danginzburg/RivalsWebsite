import { describe, expect, it } from 'vitest'
import {
  diffRosters,
  displayName,
  parseChanges,
  parseRoster,
  type RosterEntry,
} from './roster-diff'
import { rosterHistoryValue, teamRosterPayload, teamUpdatePayload } from './embeds'
import type { DiscordEmbed, WebhookPayload } from './webhook'

const entry = (name: string, role: RosterEntry['role'], id: Partial<RosterEntry> = {}) => ({
  name,
  role,
  profileId: null,
  puuid: null,
  nameKey: name.toLowerCase(),
  ...id,
})

const embed = (p: WebhookPayload) => (p.embeds ?? [])[0] as Required<DiscordEmbed>

const team = {
  name: 'Project 30',
  tag: 'P30',
  logoUrl: 'https://cdn.test/p30.png',
  seasonName: 'Season 5',
  teamUrl: 'https://rivals.test/teams/t-1',
}

describe('diffRosters', () => {
  it('finds adds, removals and role changes', () => {
    const before = [entry('Alpha', 'captain'), entry('Bravo', 'player'), entry('Charlie', 'player')]
    const after = [entry('Alpha', 'captain'), entry('Bravo', 'coach'), entry('Delta', 'substitute')]
    expect(diffRosters(before, after)).toEqual([
      { type: 'added', name: 'Delta', role: 'substitute' },
      { type: 'role', name: 'Bravo', from: 'player', to: 'coach' },
      { type: 'removed', name: 'Charlie', role: 'player' },
    ])
  })

  it('is empty when a mistake was undone', () => {
    const roster = [entry('Alpha', 'captain'), entry('Bravo', 'player')]
    expect(diffRosters(roster, [...roster].reverse())).toEqual([])
  })

  it('matches a player whose roster name was fixed, by profile', () => {
    const before = [entry('alpha', 'player', { profileId: 'p1', nameKey: 'alpha' })]
    const after = [entry('Alpha', 'player', { profileId: 'p1', nameKey: 'alpha#na1' })]
    expect(diffRosters(before, after)).toEqual([])
  })

  it('matches by PUUID when only one side has a profile', () => {
    const before = [entry('Alpha', 'player', { puuid: 'u1', nameKey: 'alpha' })]
    const after = [
      entry('Alpha', 'substitute', { puuid: 'u1', profileId: 'p1', nameKey: 'alpha#na1' }),
    ]
    expect(diffRosters(before, after)).toEqual([
      { type: 'role', name: 'Alpha', from: 'player', to: 'substitute' },
    ])
  })
})

describe('snapshot parsing', () => {
  it('strips the Riot tag for display', () => {
    expect(displayName('ToasterDeus#NA1', null)).toBe('ToasterDeus')
    expect(displayName(null, 'Toaster')).toBe('Toaster')
    expect(displayName('', '')).toBe('Unknown player')
  })

  it('tolerates junk', () => {
    expect(parseRoster(null)).toEqual([])
    expect(parseRoster([{ name: 'A', role: 'nope' }])[0].role).toBe('player')
    expect(
      parseChanges([{ type: 'bogus' }, { type: 'removed', name: 'A', role: 'coach' }])
    ).toEqual([{ type: 'removed', name: 'A', role: 'coach' }])
  })
})

describe('roster posts', () => {
  it('groups the creation post by role and adds history', () => {
    const e = embed(
      teamRosterPayload(
        team,
        [
          entry('Zed', 'player'),
          entry('Alpha', 'captain'),
          entry('Bo', 'player'),
          entry('Cy', 'coach'),
          entry('Dee', 'substitute'),
          entry('Em', 'manager'),
        ],
        [
          {
            at: '2026-11-25T00:00:00.000Z',
            changes: [
              { type: 'added', name: 'Bo', role: 'player' },
              { type: 'removed', name: 'Old', role: 'player' },
            ],
          },
        ]
      )
    )
    expect(e.title).toBe('Project 30 [P30]')
    expect(e.thumbnail).toEqual({ url: team.logoUrl })
    expect(e.description).toBe('3 players · 1 sub · 2 staff')
    // One column: no inline fields.
    expect(e.fields.some((f) => 'inline' in f)).toBe(false)
    expect(e.fields.map((f) => [f.name, f.value])).toEqual([
      ['Players', '• **Alpha** · *Captain*\n• Bo\n• Zed'],
      ['Substitutes', '• Dee'],
      ['Staff', '• Cy · *Coach*\n• Em · *Manager*'],
      [
        'Change history',
        `**<t:${Date.parse('2026-11-25T00:00:00.000Z') / 1000}:D>**\n• **Bo** joined\n• **Old** left`,
      ],
    ])
  })

  it('says so when the roster is empty', () => {
    const e = embed(teamRosterPayload(team, [], []))
    expect(e.description).toBeUndefined()
    expect(e.fields).toEqual([{ name: 'Players', value: '*No players yet*' }])
  })

  it('lists an update one change per line', () => {
    const e = embed(
      teamUpdatePayload(
        team,
        [
          { type: 'added', name: 'Delta', role: 'substitute' },
          { type: 'removed', name: 'Charlie', role: 'player' },
          { type: 'role', name: 'Bravo', from: 'player', to: 'coach' },
        ],
        '2026-11-25T00:00:00.000Z'
      )
    )
    expect(e.title).toBe('Project 30 [P30] roster update')
    expect(e.description).toBe(
      '• **Delta** joined as Sub\n• **Charlie** left\n• **Bravo**: Player → Coach'
    )
  })

  it('keeps the newest history within the field limit', () => {
    const history = Array.from({ length: 60 }, (_, i) => ({
      at: '2026-11-25T00:00:00.000Z',
      changes: [
        { type: 'added' as const, name: `Player number ${i}`, role: 'substitute' as const },
      ],
    }))
    const value = rosterHistoryValue(history, team.teamUrl)!
    expect(value.length).toBeLessThanOrEqual(1024)
    expect(value).toMatch(/^\+ \d+ earlier updates · \[team page\]/)
    expect(value.endsWith('**Player number 59** joined as Sub')).toBe(true)
  })
})
