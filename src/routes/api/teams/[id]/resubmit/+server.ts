import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireProfile } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getActiveMemberships, isCaptainLike } from '$lib/server/teams/membership'

export const POST: RequestHandler = async ({ locals, params }) => {
  const teamId = params.id
  if (!teamId) throw error(400, 'Missing team id')

  const profile = await requireProfile(locals.user)

  const { data: team, error: teamError } = await supabaseAdmin
    .from('teams')
    .select('id, approval_status, approval_notes, submitted_by_profile_id, logo_path')
    .eq('id', teamId)
    .maybeSingle()

  if (teamError || !team) throw error(404, 'Team not found')

  if (profile.role !== 'admin') {
    const memberships = await getActiveMemberships(profile.id)
    const isCaptainOnTeam = memberships.some((m) => m.team_id === teamId && isCaptainLike(m.role))

    if (team.submitted_by_profile_id !== profile.id && !isCaptainOnTeam) {
      throw error(403, 'Not allowed to resubmit this team')
    }
  }

  if (team.approval_status !== 'rejected') {
    throw error(409, 'Only rejected teams can be resubmitted')
  }
  if (!team.logo_path) {
    throw error(400, 'Team logo is required to resubmit')
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('teams')
    .update({
      approval_status: 'pending',
      approval_notes: null,
      approved_by_profile_id: null,
      approved_at: null,
    })
    .eq('id', teamId)
    .select('id, name, tag, approval_status, approval_notes, created_at')
    .single()

  if (updateError || !updated) throw error(500, 'Failed to resubmit team')
  return json({ success: true, team: updated })
}
