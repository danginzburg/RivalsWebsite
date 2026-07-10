import { json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { queryProfilesWithOptionalRiotIdBase } from '$lib/server/supabase/profiles'

type PlayerProfileRow = {
  id: string
  display_name: string | null
  email: string | null
  riot_id_base: string | null
  created_at: string | null
}

export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)

  const profiles = await queryProfilesWithOptionalRiotIdBase<PlayerProfileRow>({
    selectWithRiot: 'id, display_name, email, riot_id_base, created_at',
    selectWithoutRiot: 'id, display_name, email, created_at',
    order: { column: 'display_name', ascending: true },
    fatalMessage: 'Failed to load users',
  })

  const normalized = profiles.map((p) => ({
    profile_id: p.id,
    riot_id_base: p.riot_id_base ?? null,
    display_name: p.display_name ?? null,
    email: p.email ?? null,
    created_at: p.created_at ?? null,
  }))

  return json({ players: normalized })
}
