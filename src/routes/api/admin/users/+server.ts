import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

function normalizeRiotBase(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.split('#')[0].trim() || null
}

function isValidRiotBase(value: string | null) {
  if (!value) return true
  if (value.includes('#')) return false
  return value.length >= 3 && value.length <= 24
}

// GET all users
export const GET: RequestHandler = async ({ locals }) => {
  // Check if user is authenticated
  if (!locals.user) {
    throw error(401, 'You must be logged in')
  }

  // Check if user is an admin
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, role')
    .eq('auth0_sub', locals.user.sub)
    .single()

  if (profileError || !profile) {
    throw error(403, 'Profile not found')
  }

  if (profile.role !== 'admin') {
    throw error(403, 'Access denied. Administrator privileges required.')
  }

  // Fetch all users
  let users: any[] = []
  {
    const { data, error: usersError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, display_name, role, riot_id_base, created_at')
      .order('created_at', { ascending: false })

    if (usersError) {
      const msg = String((usersError as any).message ?? '')
      if (msg.toLowerCase().includes('riot_id_base')) {
        const { data: fallback, error: fallbackError } = await supabaseAdmin
          .from('profiles')
          .select('id, email, display_name, role, created_at')
          .order('created_at', { ascending: false })
        if (fallbackError) {
          console.error('Error fetching users:', fallbackError)
          throw error(500, 'Failed to fetch users')
        }
        users = (fallback ?? []).map((u: any) => ({ ...u, riot_id_base: null }))
      } else {
        console.error('Error fetching users:', usersError)
        throw error(500, 'Failed to fetch users')
      }
    } else {
      users = data ?? []
    }
  }

  return json({
    users: users || [],
  })
}

// PATCH update user role
export const PATCH: RequestHandler = async ({ locals, request }) => {
  // Check if user is authenticated
  if (!locals.user) {
    throw error(401, 'You must be logged in')
  }

  // Check if user is an admin
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, role')
    .eq('auth0_sub', locals.user.sub)
    .single()

  if (profileError || !profile) {
    throw error(403, 'Profile not found')
  }

  if (profile.role !== 'admin') {
    throw error(403, 'Access denied. Administrator privileges required.')
  }

  const body = await request.json()
  const { userId, newRole } = body
  const riotIdBase = normalizeRiotBase(body.riotIdBase)

  if (!userId) {
    throw error(400, 'User ID is required')
  }

  if (newRole) {
    const validRoles = ['user', 'admin', 'restricted', 'banned']
    if (!validRoles.includes(newRole)) {
      throw error(400, 'Invalid role')
    }
  }

  if (!isValidRiotBase(riotIdBase)) throw error(400, 'Invalid Riot ID base')

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
