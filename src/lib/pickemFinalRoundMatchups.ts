/**
 * Final Swiss round-3 pairings (teams.tag, compared uppercase).
 * Each side lists acceptable tag spellings so pairs still resolve if the DB uses a short or alternate tag.
 */
export const PICKEM_FINAL_ROUND_MATCHUP_TAG_SLOTS = [
  { first: ['CNRG'], second: ['APPL'] },
  { first: ['7UNC'], second: ['NABI'] },
  { first: ['MONZ'], second: ['VP'] },
  { first: ['PSF'], second: ['DOM'] },
  { first: ['MD'], second: ['FN4F'] },
  { first: ['BLG'], second: ['NVG'] },
  { first: ['SRB'], second: ['MIAU'] },
  { first: ['J8S'], second: ['TBC'] },
  { first: ['TRS'], second: ['PRX'] },
  { first: ['C29'], second: ['EE'] },
  { first: ['P30', 'P30FS'], second: ['AI'] },
  { first: ['LS', 'LSR'], second: ['HB'] },
] as const

/** Primary tag pair per matchup (first accepted spelling on each side) for display or legacy use */
export const PICKEM_FINAL_ROUND_MATCHUP_TAGS = PICKEM_FINAL_ROUND_MATCHUP_TAG_SLOTS.map(
  (s) => [s.first[0], s.second[0]] as const
)

export type PickemMatchupRow = {
  team?: { id?: string; tag?: string | null } | null
}

function resolveTeamIdFromTagAliases(
  tagToId: Map<string, string>,
  aliases: readonly string[]
): string | undefined {
  for (const a of aliases) {
    const id = tagToId.get(a.toUpperCase())
    if (id) return id
  }
  return undefined
}

/**
 * Ordered pairs [firstTagTeamId, secondTagTeamId] when both sides resolve in `rows`.
 */
export function buildPickemMatchupPairsFromRows(rows: PickemMatchupRow[]): [string, string][] {
  const tagToId = new Map<string, string>()
  for (const row of rows) {
    const t = row.team?.tag?.trim().toUpperCase()
    const id = row.team?.id
    if (t && id) tagToId.set(t, id)
  }

  const pairs: [string, string][] = []
  for (const slot of PICKEM_FINAL_ROUND_MATCHUP_TAG_SLOTS) {
    const ida = resolveTeamIdFromTagAliases(tagToId, slot.first)
    const idb = resolveTeamIdFromTagAliases(tagToId, slot.second)
    if (ida && idb) pairs.push([ida, idb])
  }
  return pairs
}

export function buildPickemOpponentIdByTeamId(rows: PickemMatchupRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const [a, b] of buildPickemMatchupPairsFromRows(rows)) {
    map.set(a, b)
    map.set(b, a)
  }
  return map
}

export type PickemMatchupSideMeta = { opponentId: string; isFirstInPair: boolean }

/** For each team in a known matchup, opponent id and whether this team is the first side in PICKEM_FINAL_ROUND_MATCHUP_TAG_SLOTS. */
export function buildPickemMatchupSideMetaFromRows(
  rows: PickemMatchupRow[]
): Map<string, PickemMatchupSideMeta> {
  const map = new Map<string, PickemMatchupSideMeta>()
  for (const [idFirst, idSecond] of buildPickemMatchupPairsFromRows(rows)) {
    map.set(idFirst, { opponentId: idSecond, isFirstInPair: true })
    map.set(idSecond, { opponentId: idFirst, isFirstInPair: false })
  }
  return map
}
