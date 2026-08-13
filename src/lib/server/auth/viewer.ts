import { supabaseAdmin } from '$lib/supabase/admin'

type AuthUser = { sub: string; role?: string } | null | undefined

/**
 * Resolve the signed-in viewer's profile id, or null when signed out.
 *
 * Unlike `requireProfile`, this never throws — public pages use it to decide
 * whether to show author-only controls.
 */
export async function getViewerProfileId(user: AuthUser): Promise<string | null> {
  if (!user?.sub) return null

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('auth0_sub', user.sub)
    .maybeSingle()

  return data?.id ?? null
}
