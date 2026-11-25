import { error, json, type RequestHandler } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/profile'
import { logAdminAction } from '$lib/server/audit/admin-actions'
import {
  correctLastPublish,
  publishRoster,
  rosterPreview,
  RosterPublishError,
} from '$lib/server/discord/team-roster'

/*
 * Roster announcements for one team (see $lib/server/discord/team-roster.ts).
 *   GET                       pending changes and a preview of the posts
 *   POST { action: 'publish' } announce the team, or post the pending update
 *   POST { action: 'correct' } re-do the last publish against the live roster
 */

function fail(err: unknown): never {
  if (err instanceof RosterPublishError) throw error(err.status, err.message)
  throw err
}

export const GET: RequestHandler = async ({ locals, params }) => {
  await requireAdmin(locals.user)
  if (!params.id) throw error(400, 'Missing team id')
  try {
    return json(await rosterPreview(params.id))
  } catch (err) {
    fail(err)
  }
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const admin = await requireAdmin(locals.user)
  const teamId = params.id
  if (!teamId) throw error(400, 'Missing team id')
  const body = await request.json().catch(() => ({}))

  try {
    if (body.action === 'publish') {
      const result = await publishRoster(teamId, admin.id)
      await logAdminAction({
        adminProfileId: admin.id,
        actionType: result.kind === 'initial' ? 'team_roster_announced' : 'team_roster_published',
        targetTable: 'teams',
        targetId: teamId,
        details: { changes: result.changes },
      })
      return json({ success: true, ...result })
    }
    if (body.action === 'correct') {
      const result = await correctLastPublish(teamId, admin.id)
      await logAdminAction({
        adminProfileId: admin.id,
        actionType: 'team_roster_corrected',
        targetTable: 'teams',
        targetId: teamId,
        details: { outcome: result.outcome, changes: result.changes },
      })
      return json({ success: true, ...result })
    }
  } catch (err) {
    fail(err)
  }
  throw error(400, 'Unknown action')
}
