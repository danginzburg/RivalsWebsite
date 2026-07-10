export function supabaseErrorMessageIncludes(err: unknown, substring: string): boolean {
  const msg = String((err as { message?: string }).message ?? '').toLowerCase()
  return msg.includes(substring.toLowerCase())
}
