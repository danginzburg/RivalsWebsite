import { teamName } from './match-ui'
import type { AdminSelectOption } from './types'

type ProfileLike = { display_name?: string | null; email?: string | null }

type TeamOptionSource = {
  id: string
  name: string
  tag: string | null
}

type FilterableAdminMatch = {
  status: string | null | undefined
  team_a?: unknown
  team_b?: unknown
}

export function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase()
}

export function profileLabel(profileRel: unknown): string {
  if (!profileRel) return '—'

  if (Array.isArray(profileRel)) {
    const first = profileRel[0] as ProfileLike | undefined
    return first?.display_name || first?.email || '—'
  }

  const single = profileRel as ProfileLike
  return single.display_name || single.email || '—'
}

export function filterAdminMatches<T extends FilterableAdminMatch>(
  matches: T[],
  query: string,
  showCompleted: boolean
): T[] {
  const normalizedQuery = normalizeSearchValue(query)

  return matches.filter((match) => {
    if (!showCompleted && match.status === 'completed') return false
    if (!normalizedQuery) return true

    const haystack = [teamName(match.team_a), teamName(match.team_b), match.status ?? '']
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalizedQuery)
  })
}

export function buildApprovedTeamOptions(teams: TeamOptionSource[]): AdminSelectOption[] {
  return teams.map((team) => ({
    label: `${team.name}${team.tag ? ` [${String(team.tag).toUpperCase()}]` : ''}`,
    value: team.id,
  }))
}
