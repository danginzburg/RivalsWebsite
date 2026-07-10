import { supabaseAdmin } from '../../src/lib/supabase/admin'

export { supabaseAdmin }

export async function resolveAdminUserId(override?: string | null): Promise<{
  profileId: string
  authSub: string
}> {
  if (override) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, auth0_sub, role')
      .eq('id', override)
      .maybeSingle()
    if (error || !data) throw new Error(`Admin override profile ${override} not found`)
    if (!data.auth0_sub) throw new Error(`Admin override profile ${override} has no auth0_sub`)
    return { profileId: data.id, authSub: data.auth0_sub }
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, auth0_sub, role')
    .eq('role', 'admin')
    .not('auth0_sub', 'is', null)
    .limit(1)
    .maybeSingle()

  if (error || !data) {
    throw new Error(
      'Could not find an admin profile with auth0_sub set. Pass --admin <profileId> explicitly.'
    )
  }

  return { profileId: data.id, authSub: data.auth0_sub as string }
}

export function makeAdminEvent<T = unknown>(authSub: string, payload: unknown): T {
  return {
    locals: {
      user: { sub: authSub, role: 'admin' },
    },
    request: new Request('http://local.invalid/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  } as unknown as T
}
