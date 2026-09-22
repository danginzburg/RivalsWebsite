import { redirect } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { listUnlinkedIdentities } from '$lib/server/players/riot-identities'

export const load = async ({ locals }: { locals: App.Locals }) => {
  if (!locals.user) {
    throw redirect(303, '/auth/login?returnTo=/admin/riot-identities')
  }

  await requireAdmin(locals.user)

  const [identities, { data: profiles }] = await Promise.all([
    listUnlinkedIdentities(),
    supabaseAdmin
      .from('profiles')
      .select('id, display_name, riot_id_base')
      .order('display_name', { ascending: true, nullsFirst: false }),
  ])

  return {
    identities,
    profiles: (profiles ?? []).map((p) => ({
      id: p.id,
      label: p.display_name ?? p.riot_id_base ?? 'Unnamed player',
    })),
  }
}
