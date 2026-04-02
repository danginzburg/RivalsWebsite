// Veto functionality has been removed. Expose minimal stubs to avoid import errors.

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

export function bo3VetoSteps(): Bo3VetoStep[] {
  return []
}

export function normalizeMapPool(value: unknown): string[] {
  return DEFAULT_MAP_POOL
}

export function getUsedMaps(_actions: VetoAction[]): Set<string> {
  return new Set<string>()
}

export function getRemainingMaps(mapPool: string[], _actions: VetoAction[]): string[] {
  return mapPool
}

export function getDeciderMap(_mapPool: string[], _actions: VetoAction[]): string | null {
  return null
}

export function getPickedMaps(_actions: VetoAction[]): string[] {
  return []
}
