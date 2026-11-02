/** A season's MVP: a linked profile, or a placeholder name for a player who hasn't signed up yet. */
export type SeasonMvp = { id: string | null; name: string }

/** Placeholder MVP name stored on `seasons.metadata.mvp_name`. */
export function seasonMvpName(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return ''
  const name = (metadata as Record<string, unknown>).mvp_name
  return typeof name === 'string' ? name.trim() : ''
}

/** The picked profile wins; the placeholder name only fills in when none is set. */
export function resolveSeasonMvp(
  profile: { id: string; display_name: string | null } | null,
  metadata: unknown
): SeasonMvp | null {
  if (profile) return { id: profile.id, name: profile.display_name ?? 'Player' }
  const name = seasonMvpName(metadata)
  return name ? { id: null, name } : null
}
