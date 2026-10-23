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

type RangeQuery<T> = {
  range: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
}

export async function fetchAllRows<T>(build: () => RangeQuery<T>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}
