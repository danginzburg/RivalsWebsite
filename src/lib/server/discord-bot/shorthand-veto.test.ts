import { describe, expect, it } from 'vitest'
import { parseShorthandVeto, type ShorthandContext } from './shorthand-veto'

const POOL = ['Ascent', 'Breeze', 'Fracture', 'Haven', 'Lotus', 'Pearl', 'Split']
const context: ShorthandContext = {
  teams: [
    { name: 'Vantage Point', tag: 'VP' },
    { name: 'Nova Gaming', tag: 'NVG' },
  ],
  mapPool: POOL,
}

/** The example from the league's Discord, exactly as typed. */
const EXAMPLE = `VP Atk breeze
VP Bans Lotus
NVG Bans Fracture
VP Picks Pearl (NVG Def)
NVG Pick Haven (VP Atk)
VP Ban Split
Nvg ban ascent
Breeze remains (VP Atk)`

const EXPECTED = [
  'VP bans Lotus',
  'NVG bans Fracture',
  'VP picks Pearl · NVG starts Defender',
  'NVG picks Haven · VP starts Attacker',
  'VP bans Split',
  'NVG bans Ascent',
  'Breeze decider · VP starts Attacker',
]

const parse = (text: string, ctx = context) => parseShorthandVeto(text.split('\n'), ctx)

describe('parseShorthandVeto', () => {
  it('reads the real example', () => {
    expect(parse(EXAMPLE)).toEqual(EXPECTED)
  })

  it('ignores case and spacing in teams, maps and words', () => {
    expect(parse(EXAMPLE.toUpperCase())).toEqual(EXPECTED)
    expect(parse(EXAMPLE.toLowerCase())).toEqual(EXPECTED)
    expect(parse(EXAMPLE.replace(/ /g, '  '))).toEqual(EXPECTED)
  })

  it('takes team names as well as tags', () => {
    const named = EXAMPLE.replace(/^VP /gm, 'Vantage Point ').replace(/^NVG /gm, 'nova gaming ')
    expect(parse(named)).toEqual(EXPECTED)
  })

  it('accepts every verb and side spelling', () => {
    const text = `VP banned Lotus
NVG bans Fracture
VP picked Pearl (NVG Defense)
NVG picks Haven (VP Attack)
VP ban Split
NVG Ban Ascent
Breeze remains (VP Attacker)`
    expect(parse(text)).toEqual(EXPECTED)
    expect(parse(text.replace('(VP Attacker)', '(NVG Defender)'))).toEqual(
      EXPECTED.slice(0, 6).concat('Breeze decider · NVG starts Defender')
    )
  })

  it('reads every way of writing the decider', () => {
    const steps = EXAMPLE.split('\n').slice(1, 7).join('\n')
    for (const decider of [
      'Breeze remains',
      'Breeze decider',
      'decider Breeze',
      'Decider: Breeze',
      'Breeze is the decider',
    ]) {
      expect(parse(`${steps}\n${decider} (VP Atk)`)).toEqual(EXPECTED)
    }
  })

  it('ignores chat around the veto', () => {
    expect(parse(`gg, veto below\n${EXAMPLE}\nsee you thursday`)).toEqual(EXPECTED)
  })

  it('needs every map in the pool', () => {
    expect(parse(EXAMPLE.replace('Nvg ban ascent', ''))).toBeNull()
  })

  it('rejects a map used twice, two deciders or no pick', () => {
    expect(parse(EXAMPLE.replace('VP Ban Split', 'VP Ban Lotus'))).toBeNull()
    expect(parse(`${EXAMPLE}\nSplit remains`)).toBeNull()
    const noPicks = `VP bans Lotus
NVG bans Fracture
VP bans Pearl
NVG bans Haven
VP bans Split
NVG bans Ascent
Breeze remains`
    expect(parse(noPicks)).toBeNull()
  })

  it('rejects teams that are not in the match', () => {
    expect(parse(EXAMPLE.replace(/NVG|Nvg/g, 'C9'))).toBeNull()
    expect(parse(EXAMPLE.replace('(NVG Def)', '(C9 Def)'))).toBeNull()
  })

  it('rejects sides that contradict each other or sit on a banned map', () => {
    expect(parse(EXAMPLE.replace('VP Atk breeze', 'VP Def breeze'))).toBeNull()
    expect(parse(EXAMPLE.replace('VP Bans Lotus', 'VP Bans Lotus (NVG Def)'))).toBeNull()
  })

  it('accepts the same side said from the other team', () => {
    // The first mention is the one shown; the later one agrees with it.
    expect(parse(EXAMPLE.replace('VP Atk breeze', 'NVG Def breeze'))).toEqual(
      EXPECTED.slice(0, 6).concat('Breeze decider · NVG starts Defender')
    )
  })

  it('never treats ordinary chat as a veto', () => {
    expect(parse('we pick haven?\nVP ban split lol\nbreeze remains imo')).toBeNull()
    expect(parse('')).toBeNull()
  })

  it('uses any 7 known maps when the season has no pool', () => {
    expect(parse(EXAMPLE, { ...context, mapPool: null })).toEqual(EXPECTED)
    expect(parse(EXAMPLE.replace('Nvg ban ascent', ''), { ...context, mapPool: null })).toBeNull()
  })

  it('follows a season pool with other maps', () => {
    const pool = ['Abyss', 'Bind', 'Breeze', 'Corrode', 'Haven', 'Pearl', 'Split']
    const text = `VP ban Abyss
NVG ban Bind
VP pick Pearl
NVG pick Haven
VP ban Split
NVG ban Corrode
Breeze remains`
    expect(parse(text, { ...context, mapPool: pool })).toHaveLength(7)
    expect(parse(EXAMPLE, { ...context, mapPool: pool })).toBeNull()
  })
})
