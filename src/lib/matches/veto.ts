export type VetoActionType = 'ban' | 'pick'

export const DEFAULT_MAP_POOL = ['Haven', 'Corrode', 'Breeze', 'Split', 'Abyss', 'Pearl', 'Bind']

export type VetoAction = {
  id?: number
  match_id?: string
  acting_team_id: string
  acting_profile_id?: string
  action_type: string
  map_name: string
  action_order: number
  created_at?: string
}

export type Bo3VetoStep = {
  order: number
  actionType: VetoActionType
  actingTeamId: string
}

export function bo3VetoSteps(startingTeamId: string, otherTeamId: string): Bo3VetoStep[] {
  // Standard BO3: A ban, B ban, A pick, B pick, A ban, B ban => remaining map is decider.
  return [
    { order: 1, actionType: 'ban', actingTeamId: startingTeamId },
    { order: 2, actionType: 'ban', actingTeamId: otherTeamId },
    { order: 3, actionType: 'pick', actingTeamId: startingTeamId },
    { order: 4, actionType: 'pick', actingTeamId: otherTeamId },
    { order: 5, actionType: 'ban', actingTeamId: startingTeamId },
    { order: 6, actionType: 'ban', actingTeamId: otherTeamId },
  ]
}

export function normalizeMapPool(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_MAP_POOL
  const clean = value
    .filter((m) => typeof m === 'string')
    .map((m) => m.trim())
    .filter((m) => m.length > 0)

  return clean.length > 0 ? clean : DEFAULT_MAP_POOL
}

export function getUsedMaps(actions: VetoAction[]): Set<string> {
  const used = new Set<string>()
  for (const action of actions) {
    if (typeof action.map_name === 'string' && action.map_name.trim()) used.add(action.map_name)
  }
  return used
}

export function getRemainingMaps(mapPool: string[], actions: VetoAction[]): string[] {
  const used = getUsedMaps(actions)
  return mapPool.filter((m) => !used.has(m))
}

export function getDeciderMap(mapPool: string[], actions: VetoAction[]): string | null {
  const remaining = getRemainingMaps(mapPool, actions)
  return remaining.length === 1 ? remaining[0] : null
}

export function getPickedMaps(actions: VetoAction[]): string[] {
  return actions
    .filter((a) => a.action_type === 'pick')
    .sort((a, b) => a.action_order - b.action_order)
    .map((a) => a.map_name)
}
