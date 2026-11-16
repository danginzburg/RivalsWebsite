/**
 * PostgREST caps every response at 1000 rows (the project's `max_rows`) and
 * truncates silently — no error, just a short page. Any query whose result can
 * grow with the league (per-map stats across a season, say) must page through
 * with this instead of trusting a single `select`.
 *
 * `build` is called once per page and must return a fresh query each time,
 * with a stable order so pages neither overlap nor skip rows.
 */

const PAGE_SIZE = 1000

type PageError = { message: string; code?: string; details?: string | null }

type RangeQuery<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PageError | null }>
}

/**
 * Like `fetchAllRows`, but returns the first page error instead of throwing,
 * in the same `{ data, error }` shape as a single supabase-js query. For
 * loaders that inspect the error (an unreachable database, say) rather than
 * fail outright. Rows from pages before the failure are dropped.
 */
export async function fetchAllRowsResult<T>(
  build: () => RangeQuery<T>
): Promise<{ data: T[]; error: PageError | null }> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1)
    if (error) return { data: [], error }
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return { data: rows, error: null }
  }
}

export async function fetchAllRows<T>(build: () => RangeQuery<T>): Promise<T[]> {
  const { data, error } = await fetchAllRowsResult(build)
  if (error) throw new Error(error.message)
  return data
}
