import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

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

  // Fetch player registrations with profile info
  const { data: players, error: playersError } = await supabaseAdmin
    .from('player_registration')
    .select(
      `
      id,
      riot_id,
      pronouns,
      tracker_links,
      created_at,
      updated_at,
      profiles (
        email,
        display_name
      )
    `
    )
    .order('created_at', { ascending: false })

  if (playersError) {
    console.error('Error fetching players:', playersError)
    throw error(500, 'Failed to fetch player registrations')
  }

  // Fetch observer registrations with profile info
  const { data: observers, error: observersError } = await supabaseAdmin
    .from('observer_registration')
    .select(
      `
      id,
      has_previous_experience,
      can_stream_quality,
      willing_to_use_overlay,
      additional_info,
      created_at,
      updated_at,
      profiles (
        email,
        display_name
      )
    `
    )
    .order('created_at', { ascending: false })

  if (observersError) {
    console.error('Error fetching observers:', observersError)
    throw error(500, 'Failed to fetch observer registrations')
  }

  return json({
    players: players || [],
    observers: observers || [],
  })
}
