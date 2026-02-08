import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

export const POST: RequestHandler = async ({ request, locals }) => {
  // Check if user is authenticated
  if (!locals.user) {
    throw error(401, 'You must be logged in to register')
  }

  try {
    const { riotId, pronouns, trackerLinks } = await request.json()

    // Validate required fields
    if (!riotId || !pronouns) {
      throw error(400, 'Missing required fields')
    }

    // Get user's auth0 sub from the authenticated session
    const auth0Sub = locals.user.sub

    if (!auth0Sub) {
      throw error(401, 'Unable to identify user')
    }

    // Find the user's profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('auth0_sub', auth0Sub)
      .single()

    if (profileError || !profile) {
      throw error(404, 'User profile not found. Please try logging out and back in.')
    }

    if (profile.role === 'restricted' || profile.role === 'banned') {
      throw error(403, 'Your account is restricted and cannot participate.')
    }

    // Insert or update registration (upsert)
    const { error: upsertError } = await supabaseAdmin.from('player_registration').upsert(
      {
        profile_id: profile.id,
        riot_id: riotId,
        pronouns,
        tracker_links: trackerLinks || [],
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'profile_id',
      }
    )

    if (upsertError) {
      console.error('Upsert error:', upsertError)
      throw error(500, 'Failed to save registration')
    }

    return json({ success: true, message: 'Registration successful' })
  } catch (err) {
    console.error('Registration error:', err)
    if (err instanceof Error && 'status' in err) {
      throw err
    }
    throw error(500, 'Failed to save registration')
  }
}
