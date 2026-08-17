import { supabaseAdmin } from '$lib/supabase/admin'
import { rebuildPlayerMatchStats } from '$lib/server/imports/matching'

/**
 * Manual per-match stat overrides.
 *
 * A reassignment moves one source account's stat rows in a single match to a
 * different profile — the "I played on someone else's account this once" case.
 * It is deliberately scoped to the match and stored by source key (PUUID first,
 * else player name) so a re-import, which re-runs automatic matching, re-applies
 * the override on top instead of resetting the row to the account's real owner.
 */
export type MatchStatReassignment = {
  id: string
  match_id: string
  puuid: string | null
  player_name: string | null
  profile_id: string
  note: string | null
}

export async function loadMatchStatReassignments(
  matchId: string
): Promise<MatchStatReassignment[]> {
  const { data, error } = await supabaseAdmin
    .from('match_stat_reassignments')
    .select('id, match_id, puuid, player_name, profile_id, note')
    .eq('match_id', matchId)

  if (error) throw new Error('Failed to load match stat reassignments')
  return (data ?? []) as MatchStatReassignment[]
}

/**
 * Re-point player_match_map_stats.profile_id for a match according to its
 * reassignments, and return how many stat rows were moved. The caller rebuilds
 * player_match_stats afterwards so the series aggregate follows.
 */
export async function applyMatchStatReassignments(matchId: string): Promise<number> {
  const reassignments = await loadMatchStatReassignments(matchId)
  if (reassignments.length === 0) return 0

  let moved = 0
  for (const r of reassignments) {
    let query = supabaseAdmin
      .from('player_match_map_stats')
      .update({ profile_id: r.profile_id })
      .eq('match_id', matchId)

    // PUUID is the reliable key; fall back to the exact player name for rows
    // (CSV imports) that never carried one.
    if (r.puuid) {
      query = query.eq('metadata->>puuid', r.puuid)
    } else if (r.player_name) {
      query = query.eq('player_name', r.player_name)
    } else {
      continue
    }

    const { data, error } = await query.select('id')
    if (error) {
      console.warn('applyMatchStatReassignments failed for', r.id, error.message)
      continue
    }
    moved += data?.length ?? 0
  }
  return moved
}

/**
 * Create or update a per-match reassignment, then re-point the affected stat
 * rows and rebuild the series aggregate so the change shows immediately. The
 * pre-override owner is captured on first creation so a later removal restores
 * it exactly.
 */
export async function upsertMatchStatReassignment(opts: {
  matchId: string
  puuid: string | null
  playerName: string | null
  profileId: string
  note?: string | null
  createdByProfileId: string
}): Promise<void> {
  const { matchId, puuid, playerName, profileId } = opts
  if (!puuid && !playerName) throw new Error('A puuid or player name is required')

  const { data: existing } = await supabaseAdmin
    .from('match_stat_reassignments')
    .select('id, previous_profile_id')
    .eq('match_id', matchId)
    .eq(puuid ? 'puuid' : 'player_name', (puuid ?? playerName) as string)
    .maybeSingle()

  // Capture the current owner only the first time, before we overwrite it.
  let previousProfileId: string | null = existing?.previous_profile_id ?? null
  if (!existing) {
    let capture = supabaseAdmin
      .from('player_match_map_stats')
      .select('profile_id')
      .eq('match_id', matchId)
      .limit(1)
    capture = puuid
      ? capture.eq('metadata->>puuid', puuid)
      : capture.eq('player_name', playerName as string)
    const { data: rows } = await capture
    previousProfileId = (rows?.[0]?.profile_id as string | null) ?? null
  }

  const payload = {
    match_id: matchId,
    puuid,
    player_name: playerName,
    profile_id: profileId,
    previous_profile_id: previousProfileId,
    note: opts.note ?? null,
    created_by_profile_id: opts.createdByProfileId,
  }

  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from('match_stat_reassignments')
      .update(payload)
      .eq('id', existing.id)
    if (error) throw new Error('Failed to update reassignment')
  } else {
    const { error } = await supabaseAdmin.from('match_stat_reassignments').insert(payload)
    if (error) throw new Error('Failed to create reassignment')
  }

  await applyMatchStatReassignments(matchId)
  await rebuildPlayerMatchStats(matchId)
}

/**
 * Remove a reassignment and restore the affected rows to their pre-override
 * owner, then rebuild.
 */
export async function removeMatchStatReassignment(
  matchId: string,
  reassignmentId: string
): Promise<void> {
  const { data: reassignment } = await supabaseAdmin
    .from('match_stat_reassignments')
    .select('id, puuid, player_name, profile_id, previous_profile_id')
    .eq('id', reassignmentId)
    .eq('match_id', matchId)
    .maybeSingle()

  if (!reassignment) return

  // Restore only the rows still pointing at the override target.
  let restore = supabaseAdmin
    .from('player_match_map_stats')
    .update({ profile_id: reassignment.previous_profile_id ?? null })
    .eq('match_id', matchId)
    .eq('profile_id', reassignment.profile_id)
  if (reassignment.puuid) {
    restore = restore.eq('metadata->>puuid', reassignment.puuid)
  } else if (reassignment.player_name) {
    restore = restore.eq('player_name', reassignment.player_name)
  }
  const { error: restoreError } = await restore
  if (restoreError) throw new Error('Failed to restore reassigned stats')

  await supabaseAdmin.from('match_stat_reassignments').delete().eq('id', reassignmentId)
  await rebuildPlayerMatchStats(matchId)
}
