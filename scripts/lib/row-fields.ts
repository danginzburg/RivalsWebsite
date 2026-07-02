export function pickField(row: Record<string, unknown>, candidates: string[]): unknown {
  for (const key of Object.keys(row)) {
    if (candidates.includes(key.toLowerCase().trim())) return row[key]
  }
  return null
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// Some exports provide KAST/HS as 0-1 instead of 0-100.
export function toPercent(value: unknown): number | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (/^n\/?a$/i.test(raw)) return null

  const hasPercent = raw.includes('%')
  const cleaned = raw.replace('%', '').trim()
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  if (!hasPercent && n > 0 && n <= 1) return n * 100
  return n
}

export function numberFromRow(row: Record<string, unknown>, candidates: string[]): number {
  return toNumber(pickField(row, candidates)) ?? 0
}

export function percentFromRow(row: Record<string, unknown>, candidates: string[]): number {
  return toPercent(pickField(row, candidates)) ?? 0
}

export function stringFromRow(row: Record<string, unknown>, candidates: string[]): string | null {
  const value = pickField(row, candidates)
  return typeof value === 'string' ? value.trim() : value != null ? String(value) : null
}

export function playerNameFromRow(row: Record<string, unknown>): string | null {
  return stringFromRow(row, ['player', 'player_name', 'player name', 'name'])
}
