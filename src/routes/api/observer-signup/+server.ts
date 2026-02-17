import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

export const POST: RequestHandler = async ({ request, locals }) => {
  // Check if user is authenticated
  if (!locals.user) {
    throw error(401, 'You must be logged in to sign up as an observer')
  }

  try {
    const { hasPreviousExperience, canStreamQuality, willingToUseOverlay, additionalInfo } =
      await request.json()

    // Validate required fields
    if (
      hasPreviousExperience === undefined ||
      canStreamQuality === undefined ||
      willingToUseOverlay === undefined ||
      !additionalInfo
    ) {
      throw error(400, 'Please answer all questions')
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

    const { data: existingObserverRegistration, error: existingObserverRegistrationError } =
      await supabaseAdmin
        .from('observer_registration')
        .select('id')
        .eq('profile_id', profile.id)
        .maybeSingle()

    if (existingObserverRegistrationError) {
      throw error(500, 'Failed to validate existing observer registration')
    }

    if (existingObserverRegistration) {
      throw error(409, 'You have already signed up as an observer')
    }

    // Insert observer registration (single submission)
    const { error: upsertError } = await supabaseAdmin.from('observer_registration').insert({
      profile_id: profile.id,
      has_previous_experience: hasPreviousExperience,
      can_stream_quality: canStreamQuality,
      willing_to_use_overlay: willingToUseOverlay,
      additional_info: additionalInfo,
      updated_at: new Date().toISOString(),
    })

    if (upsertError) {
      console.error('Upsert error:', upsertError)
      throw error(500, 'Failed to save observer registration')
    }

    return json({ success: true, message: 'Observer registration successful' })
  } catch (err) {
    console.error('Observer registration error:', err)
    if (err instanceof Error && 'status' in err) {
      throw err
    }
    throw error(500, 'Failed to save observer registration')
  }
}
