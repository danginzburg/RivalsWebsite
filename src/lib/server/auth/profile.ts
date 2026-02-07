import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'

type AuthUser = {
  sub: string
  role?: string
}

export async function requireProfile(user: AuthUser | null) {
  if (!user) {
    throw error(401, 'You must be logged in')
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, role, display_name, email')
    .eq('auth0_sub', user.sub)
    .single()

  if (profileError || !profile) {
    throw error(403, 'Profile not found')
  }

  return profile
}

export async function requireAdmin(user: AuthUser | null) {
  const profile = await requireProfile(user)
  if (profile.role !== 'admin') {
    throw error(403, 'Administrator privileges required')
  }
  return profile
}
