import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ fetch }) => {
  const res = await fetch('/api/matches?limit=5')
  const body = await res.json().catch(() => ({}))

  return {
    matches: body.matches ?? [],
  }
}
