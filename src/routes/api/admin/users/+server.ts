import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'
import { requireAdmin } from '$lib/server/auth/profile'
import { normalizeRiotBaseNullable, isValidRiotBaseLenient } from '$lib/server/riot-id'
import { queryProfilesWithOptionalRiotIdBase } from '$lib/server/supabase/profiles'

type AdminUserRow = {
  id: string
  email: string | null
  display_name: string | null
  role: string | null
  riot_id_base: string | null
  created_at: string | null
}

// GET all users
export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)

  const users = await queryProfilesWithOptionalRiotIdBase<AdminUserRow>({
    selectWithRiot: 'id, email, display_name, role, riot_id_base, created_at',
    selectWithoutRiot: 'id, email, display_name, role, created_at',
    order: { column: 'created_at', ascending: false },
    fatalMessage: 'Failed to fetch users',
  })

  return json({
    users: users || [],
  })
}

// PATCH update user role
export const PATCH: RequestHandler = async ({ locals, request }) => {
  const profile = await requireAdmin(locals.user)

  const body = await request.json()
  const { userId, newRole } = body
  const riotIdBase = normalizeRiotBaseNullable(body.riotIdBase)

  if (!userId) {
    throw error(400, 'User ID is required')
  }

  if (newRole) {
    const validRoles = ['user', 'admin', 'restricted', 'banned']
    if (!validRoles.includes(newRole)) {
      throw error(400, 'Invalid role')
    }
  }

  if (!isValidRiotBaseLenient(riotIdBase)) throw error(400, 'Invalid Riot ID base')

  // Prevent admin from changing their own role (safety measure)
  if (userId === profile.id) {
    throw error(400, 'You cannot change your own role')
  }

  // Check the target user's current role
  const { data: targetUser, error: targetError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (targetError || !targetUser) {
    throw error(404, 'Target user not found')
  }

  // Prevent removing admin access from other admins (can only be done in database)
  if (newRole && targetUser.role === 'admin' && newRole !== 'admin') {
    throw error(403, 'Cannot remove admin access. This can only be done directly in the database.')
  }

  if (riotIdBase) {
    const { data: existingRiotId } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('riot_id_base', riotIdBase)
      .neq('id', userId)
      .maybeSingle()

    if (existingRiotId?.id) {
      throw error(409, 'That Riot ID is already claimed by another account')
    }
  }

  const updatePayload: Record<string, unknown> = {}
  if (newRole) updatePayload.role = newRole
  if ('riotIdBase' in body) updatePayload.riot_id_base = riotIdBase

  if (Object.keys(updatePayload).length === 0) {
    throw error(400, 'No user updates provided')
  }

  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update(updatePayload)
    .eq('id', userId)

  if (updateError) {
    console.error('Error updating user role:', updateError)
    throw error(500, 'Failed to update user role')
  }

  return json({
    success: true,
    message: newRole ? `User role updated to ${newRole}` : 'User updated successfully',
  })
}
