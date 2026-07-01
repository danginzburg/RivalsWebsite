/** Shape shared by Supabase/Postgrest errors and thrown Error objects. */
export type ErrorLike = { message?: string | null } | null | undefined

/** Safely extract an error message string from an unknown/error-like value. */
export function errorMessage(err: unknown): string {
  return String((err as ErrorLike)?.message ?? '')
}
