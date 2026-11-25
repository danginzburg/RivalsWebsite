/*
 * Roster snapshots and the difference between two of them. Pure, so the
 * publish flow and its Discord posts can be tested without a database.
 */

export const ROSTER_ROLES = ['captain', 'player', 'substitute', 'coach', 'manager'] as const
export type RosterRole = (typeof ROSTER_ROLES)[number]

/** One roster spot, as stored in team_roster_announcements.roster. */
export type RosterEntry = {
  /** Display name: the Riot name without its tag, or the profile name. */
  name: string
  role: RosterRole
  profileId: string | null
  puuid: string | null
  /** Lower-cased full roster name (Riot ID or handle), the last-resort match key. */
  nameKey: string
}

export type RosterChange =
  | { type: 'added'; name: string; role: RosterRole }
  | { type: 'removed'; name: string; role: RosterRole }
  | { type: 'role'; name: string; from: RosterRole; to: RosterRole }

export function normalizeRole(role: unknown): RosterRole {
  return ROSTER_ROLES.includes(role as RosterRole) ? (role as RosterRole) : 'player'
}

/** "Name#TAG" → "Name"; a bare handle stays as it is. */
export function displayName(playerName: string | null, fallback: string | null): string {
  const raw = (playerName ?? '').trim()
  const hash = raw.lastIndexOf('#')
  const name = hash > 0 ? raw.slice(0, hash).trim() : raw
  return name || fallback?.trim() || 'Unknown player'
}

/** The same person in two snapshots: any identity they share. */
function samePlayer(a: RosterEntry, b: RosterEntry): boolean {
  if (a.profileId && b.profileId) return a.profileId === b.profileId
  if (a.puuid && b.puuid) return a.puuid === b.puuid
  return Boolean(a.nameKey) && a.nameKey === b.nameKey
}

const roleOrder = (role: RosterRole) => ROSTER_ROLES.indexOf(role)

export function sortRoster(roster: RosterEntry[]): RosterEntry[] {
  return [...roster].sort(
    (a, b) => roleOrder(a.role) - roleOrder(b.role) || a.name.localeCompare(b.name)
  )
}

/**
 * What changed from `before` to `after`. Removing and re-adding someone (how
 * a role is changed today) shows as a role change, or as nothing at all.
 */
export function diffRosters(before: RosterEntry[], after: RosterEntry[]): RosterChange[] {
  const unmatched = [...before]
  const changes: RosterChange[] = []
  for (const next of sortRoster(after)) {
    const index = unmatched.findIndex((prev) => samePlayer(prev, next))
    if (index === -1) {
      changes.push({ type: 'added', name: next.name, role: next.role })
      continue
    }
    const [prev] = unmatched.splice(index, 1)
    if (prev.role !== next.role) {
      changes.push({ type: 'role', name: next.name, from: prev.role, to: next.role })
    }
  }
  for (const prev of sortRoster(unmatched)) {
    changes.push({ type: 'removed', name: prev.name, role: prev.role })
  }
  return changes
}

/** Read a stored snapshot defensively: it is jsonb, written by older code too. */
export function parseRoster(value: unknown): RosterEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
    .map((e) => ({
      name: String(e.name ?? 'Unknown player'),
      role: normalizeRole(e.role),
      profileId: typeof e.profileId === 'string' ? e.profileId : null,
      puuid: typeof e.puuid === 'string' ? e.puuid : null,
      nameKey: typeof e.nameKey === 'string' ? e.nameKey : '',
    }))
}

export function parseChanges(value: unknown): RosterChange[] {
  if (!Array.isArray(value)) return []
  const out: RosterChange[] = []
  for (const c of value) {
    if (!c || typeof c !== 'object') continue
    const name = String((c as { name?: unknown }).name ?? 'Unknown player')
    const type = (c as { type?: unknown }).type
    if (type === 'added' || type === 'removed') {
      out.push({ type, name, role: normalizeRole((c as { role?: unknown }).role) })
    } else if (type === 'role') {
      out.push({
        type,
        name,
        from: normalizeRole((c as { from?: unknown }).from),
        to: normalizeRole((c as { to?: unknown }).to),
      })
    }
  }
  return out
}
