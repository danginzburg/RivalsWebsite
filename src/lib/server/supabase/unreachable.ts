/**
 * Distinguish "the database could not be reached" from "the query ran and
 * matched nothing".
 *
 * A transport failure surfaces from supabase-js as a PostgrestError whose
 * `code` is empty and whose message wraps the underlying fetch error, rather
 * than as a Postgres error code. Treating that as empty data makes an outage
 * look like missing content, so pages need to be able to tell them apart.
 */
export function isUnreachableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const { message, details, code } = error as {
    message?: unknown
    details?: unknown
    code?: unknown
  }

  // A real Postgres/PostgREST error carries a code; transport failures do not.
  if (typeof code === 'string' && code.length > 0) return false

  const haystack = `${String(message ?? '')} ${String(details ?? '')}`.toLowerCase()

  return (
    haystack.includes('fetch failed') ||
    haystack.includes('connecttimeouterror') ||
    haystack.includes('und_err') ||
    haystack.includes('econnrefused') ||
    haystack.includes('enotfound') ||
    haystack.includes('etimedout') ||
    haystack.includes('socket hang up')
  )
}
