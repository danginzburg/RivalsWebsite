import { error, json, type RequestHandler } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'

export const GET: RequestHandler = async () => {
  const { data, error: fetchError } = await supabaseAdmin
    .from('teams')
    .select('id, name, tag, logo_path, status, approval_status, created_at')
    .eq('approval_status', 'approved')
    .order('name', { ascending: true })

  if (fetchError) {
    throw error(500, 'Failed to load teams')
  }

  return json({ teams: data ?? [] })
}

export const POST: RequestHandler = async ({ locals, request }) => {
  void locals
  void request
  throw error(410, 'Team creation is admin-only now.')
}
