import { describe, expect, it } from 'vitest'
import {
  filterMatchChoices,
  matchChoiceLabel,
  pickMatchForThread,
  canAnswerVetoPrompt,
  latestVeto,
  linkedMessage,
  parseVetoButtonId,
  planVeto,
  vetoHash,
  vetoPromptClosed,
  vetoPromptMessage,
  vetoSavedMessage,
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

const ALICE = { id: 'u1' }
const BOB = { id: 'u2' }

describe('latestVeto', () => {
  it('reads a pasted log, ignores the chat around it and remembers who posted it', () => {
    const messages = [
      { id: '1', author: BOB, content: 'gl hf' },
      { id: '2', author: ALICE, content: `veto done:\n${LOG.join('\n')}\nsee you then` },
    ]
    expect(latestVeto(messages)).toEqual({ lines: VETO, authorId: 'u1' })
  })

  it('reads a log inside a code block or quote', () => {
    const fenced = [{ id: '1', content: '```\n' + LOG.join('\n') + '\n```' }]
    const quoted = [{ id: '1', content: LOG.map((l) => `> ${l}`).join('\n') }]
    expect(latestVeto(fenced)?.lines).toEqual(VETO)
    expect(latestVeto(quoted)?.lines).toEqual(VETO)
  })

  it('joins a log split across back-to-back messages from one person', () => {
    const messages = [
      { id: '1', author: ALICE, content: LOG.slice(0, 2).join('\n') },
      { id: '2', author: ALICE, content: LOG.slice(2).join('\n') },
    ]
    expect(latestVeto(messages)?.lines).toEqual(VETO)
  })

  it('lets a newer log replace an older one', () => {
    const corrected = LOG.map((l) => l.replace('"Lotus"', '"Breeze"'))
    const messages = [
      { id: '1', author: ALICE, content: LOG.join('\n') },
      { id: '2', author: BOB, content: 'wait, wrong decider' },
      { id: '3', author: BOB, content: corrected.join('\n') },
    ]
    const veto = latestVeto(messages)
    expect(veto?.lines.at(-1)).toBe('Breeze decider')
    expect(veto?.lines).toHaveLength(4)
    expect(veto?.authorId).toBe('u2')
  })

  it('counts a log pasted twice in a row once', () => {
    const messages = [
      { id: '1', author: ALICE, content: LOG.join('\n') },
      { id: '2', author: ALICE, content: LOG.join('\n') },
    ]
    expect(latestVeto(messages)?.lines).toEqual(VETO)
  })

  it('reads embeds too', () => {
    expect(latestVeto([{ id: '1', embeds: [{ description: LOG.join('\n') }] }])?.lines).toEqual(
      VETO
    )
  })

  it('is null when there is no log', () => {
    expect(latestVeto([{ id: '1', content: 'we ban haven lol' }])).toBeNull()
  })

  it('never reads its own messages back as a log', () => {
    const own = [
      { id: '1', content: vetoSavedMessage(VETO, 'https://x').content },
      { id: '2', content: vetoPromptMessage(VETO, 'u1', 'abc').content },
    ]
    expect(latestVeto(own)).toBeNull()
  })
})

describe('latestVeto with hand-typed vetoes', () => {
  const shorthand = {
    teams: [
      { name: 'Vantage Point', tag: 'VP' },
      { name: 'Nova Gaming', tag: 'NVG' },
    ],
    mapPool: ['Ascent', 'Breeze', 'Fracture', 'Haven', 'Lotus', 'Pearl', 'Split'],
  }
  const TYPED = [
    'VP Atk breeze',
    'VP Bans Lotus',
    'NVG Bans Fracture',
    'VP Picks Pearl (NVG Def)',
    'NVG Pick Haven (VP Atk)',
    'VP Ban Split',
    'Nvg ban ascent',
    'Breeze remains (VP Atk)',
  ]
  const TYPED_VETO = [
    'VP bans Lotus',
    'NVG bans Fracture',
    'VP picks Pearl · NVG starts Defender',
    'NVG picks Haven · VP starts Attacker',
    'VP bans Split',
    'NVG bans Ascent',
    'Breeze decider · VP starts Attacker',
  ]

  it('reads one only when given the match’s teams and pool', () => {
    const messages = [{ id: '1', author: ALICE, content: TYPED.join('\n') }]
    expect(latestVeto(messages, shorthand)).toEqual({ lines: TYPED_VETO, authorId: 'u1' })
    expect(latestVeto(messages)).toBeNull()
  })

  it('reads one typed over a few back-to-back messages', () => {
    const messages = TYPED.map((line, i) => ({ id: String(i), author: ALICE, content: line }))
    expect(latestVeto(messages, shorthand)?.lines).toEqual(TYPED_VETO)
  })

  it('lets the newest veto win, whichever form each is in', () => {
    const typedLater = [
      { id: '1', author: BOB, content: LOG.join('\n') },
      { id: '2', author: ALICE, content: TYPED.join('\n') },
    ]
    expect(latestVeto(typedLater, shorthand)?.lines).toEqual(TYPED_VETO)
    const logLater = [typedLater[1]!, { ...typedLater[0]!, id: '3' }]
    expect(latestVeto(logLater, shorthand)?.lines).toEqual(VETO)
  })

  it('skips an incomplete typed veto and keeps looking back', () => {
    const messages = [
      { id: '1', author: ALICE, content: TYPED.join('\n') },
      { id: '2', author: BOB, content: 'NVG ban ascent? VP pick pearl' },
    ]
    expect(latestVeto(messages, shorthand)?.lines).toEqual(TYPED_VETO)
  })
})

describe('planVeto', () => {
  const OTHER = ['SEN bans Pearl']
  const base = { current: [], lastImported: null, pending: null, dismissed: null }

  it('saves the first veto straight away', () => {
    expect(planVeto({ ...base, next: VETO })).toBe('save')
    expect(planVeto({ ...base, current: null, next: VETO })).toBe('save')
  })

  it('asks before replacing a veto the bot saved', () => {
    expect(planVeto({ ...base, current: OTHER, lastImported: OTHER, next: VETO })).toBe('prompt')
  })

  it('asks only once for the same log, and not again after "Keep current"', () => {
    const saved = { ...base, current: OTHER, lastImported: OTHER }
    expect(planVeto({ ...saved, pending: VETO, next: VETO })).toBe('none')
    expect(planVeto({ ...saved, dismissed: VETO, next: VETO })).toBe('none')
  })

  it('asks again when the log changes after "Keep current"', () => {
    const saved = { ...base, current: OTHER, lastImported: OTHER, dismissed: ['old'] }
    expect(planVeto({ ...saved, next: VETO })).toBe('prompt')
  })

  it('withdraws a prompt that no longer applies', () => {
    const saved = { ...base, current: OTHER, lastImported: OTHER, pending: VETO }
    expect(planVeto({ ...saved, next: [] })).toBe('withdraw')
    expect(planVeto({ ...saved, next: OTHER })).toBe('withdraw')
  })

  it('never touches a veto an admin typed on the site', () => {
    const typed = { ...base, current: ['typed by admin'], lastImported: OTHER }
    expect(planVeto({ ...typed, next: VETO })).toBe('none')
    expect(planVeto({ ...typed, pending: VETO, next: VETO })).toBe('withdraw')
    expect(planVeto({ ...base, current: ['typed by admin'], next: VETO })).toBe('none')
  })

  it('does nothing when the thread matches the match', () => {
    expect(planVeto({ ...base, current: VETO, lastImported: VETO, next: VETO })).toBe('none')
    expect(planVeto({ ...base, next: [] })).toBe('none')
  })
})

describe('veto prompt', () => {
  it('offers two buttons bound to the veto shown', () => {
    const hash = vetoHash(VETO)
    const message = vetoPromptMessage(VETO, 'u1', hash)
    const row = message.components?.[0] as {
      components: Array<{ custom_id: string; label: string }>
    }
    expect(row.components.map((b) => b.label)).toEqual(['Update veto', 'Keep current'])
    expect(row.components.map((b) => parseVetoButtonId(b.custom_id))).toEqual([
      { action: 'update', hash },
      { action: 'keep', hash },
    ])
    expect(message.content).toContain('<@u1>')
    expect(message.content).toContain('3. SEN picks Ascent · C9 starts Attacker')
    expect(message.allowed_mentions).toEqual({ parse: [], users: ['u1'] })
  })

  it('fingerprints the veto, not the prompt', () => {
    expect(vetoHash(VETO)).toBe(vetoHash([...VETO]))
    expect(vetoHash(VETO)).not.toBe(vetoHash(VETO.slice(1)))
    expect(parseVetoButtonId('veto:delete:abc')).toBeNull()
    expect(parseVetoButtonId('something else')).toBeNull()
  })

  it('closes with the outcome and removes the buttons', () => {
    const updated = vetoPromptClosed('updated', 'u2', VETO)
    expect(updated.content).toContain('Veto updated by <@u2>')
    expect(updated.components).toEqual([])
    expect(vetoPromptClosed('kept', 'u2').content).toContain('Kept the saved veto')
    expect(vetoPromptClosed('withdrawn', null).content).toContain('no longer applies')
  })

  it('lets the poster or staff answer, and nobody else', () => {
    const manageThreads = String(1n << 34n)
    expect(canAnswerVetoPrompt({ user: { id: 'u1' }, permissions: '0' }, 'u1')).toBe(true)
    expect(canAnswerVetoPrompt({ user: { id: 'u2' }, permissions: manageThreads }, 'u1')).toBe(true)
    expect(canAnswerVetoPrompt({ user: { id: 'u2' }, permissions: '8' }, 'u1')).toBe(true)
    expect(canAnswerVetoPrompt({ user: { id: 'u2' }, permissions: '0' }, 'u1')).toBe(false)
    expect(canAnswerVetoPrompt(undefined, 'u1')).toBe(false)
  })
})

describe('confirmation messages', () => {
  it('says which match a thread was linked to, without pinging anyone', () => {
    const message = linkedMessage('DOM vs NABI', 'https://site/matches/1')
    expect(message.content).toContain('**DOM vs NABI**')
    expect(message.content).toContain('https://site/matches/1')
    expect(message.allowed_mentions).toEqual({ parse: [] })
  })

  it('lists the saved veto', () => {
    const message = vetoSavedMessage(VETO, 'https://site/matches/1')
    expect(message.content).toContain('✅ Veto saved')
    expect(message.content).toContain('4. Lotus decider')
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
