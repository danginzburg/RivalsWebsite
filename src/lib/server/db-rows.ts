/**
 * Minimal row shapes for Supabase query results that are otherwise untyped.
 * These capture only the columns actually selected/consumed in the app.
 */

export type MatchStreamRow = {
  id: string
  match_id: string
  platform: string | null
  stream_url: string | null
  is_primary: boolean | null
  status: string | null
  metadata: Record<string, unknown> | null
}
