import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

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
  const { data: users, error: usersError } = await supabaseAdmin
    .from('profiles')
    .select('id, email, display_name, role, created_at')
    .order('created_at', { ascending: false })

  if (usersError) {
    console.error('Error fetching users:', usersError)
    throw error(500, 'Failed to fetch users')
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

  if (!userId || !newRole) {
    throw error(400, 'User ID and new role are required')
  }

  // Validate the role
  const validRoles = ['user', 'admin']
  if (!validRoles.includes(newRole)) {
    throw error(400, 'Invalid role. Must be "user" or "admin"')
  }

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
  if (targetUser.role === 'admin' && newRole !== 'admin') {
    throw error(403, 'Cannot remove admin access. This can only be done directly in the database.')
  }

  // Update the user's role
  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId)

  if (updateError) {
    console.error('Error updating user role:', updateError)
    throw error(500, 'Failed to update user role')
  }

  return json({ success: true, message: `User role updated to ${newRole}` })
}
