/** Form / URL values: always returns a string (empty if missing). */
export function normalizeRiotBase(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.split('#')[0].trim()
}

/** JSON bodies: `null` means absent or empty. */
export function normalizeRiotBaseNullable(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.split('#')[0].trim() || null
}

/** Account / claim flows: value must be non-empty and valid. */
export function isValidRiotBase(value: string): boolean {
  if (!value) return false
  if (value.includes('#')) return false
  return value.length >= 3 && value.length <= 24
}

/**
 * Riot tagline — the part after '#'. Riot allows 3-5 alphanumeric characters.
 * Returns null when absent or malformed so callers can reject explicitly.
 */
export function normalizeRiotTag(value: unknown): string | null {
  const raw = String(value ?? '')
    .trim()
    .replace(/^#/, '')
  if (!/^[A-Za-z0-9]{3,5}$/.test(raw)) return null
  return raw.toUpperCase()
}

/** Admin PATCH: empty or null Riot base is allowed (clear / omit). */
export function isValidRiotBaseLenient(value: string | null): boolean {
  if (!value) return true
  if (value.includes('#')) return false
  return value.length >= 3 && value.length <= 24
}
