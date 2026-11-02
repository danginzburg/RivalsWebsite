import { error, json, type RequestHandler } from '@sveltejs/kit'

import { requireAdmin } from '$lib/server/auth/profile'
import { supabaseAdmin } from '$lib/supabase/admin'
import { getRecordCategory } from '$lib/records/categories'
import { CATEGORY_ENTRY_KEY } from '$lib/server/records/overrides'
import { loadTrackRecords } from '$lib/server/records/read'
import { rebuildStatRecords } from '$lib/server/records/rebuild'
import { loadRecordTracks } from '$lib/server/records/tracks'

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** The tracks an admin can edit: Rivals, plus the side league while it runs. */
async function editableTracks() {
  const { rivals, sideLeague, display } = await loadRecordTracks()
  return { tracks: sideLeague ? [sideLeague, rivals] : [rivals], display }
}

async function parseTarget(track: unknown, category: unknown) {
  const t = normalizeOptional(track)
  const c = normalizeOptional(category)
  if (!t || !c || !getRecordCategory(c)) throw error(400, 'A valid track and category are required')
  const { tracks } = await editableTracks()
  if (!tracks.some((x) => x.key === t)) throw error(400, 'That track is not editable')
  return { track: t, category: c }
}

/**
 * Hiding or un-hiding one performance changes who makes the top 5, so the
 * records are recomputed straight away rather than at the next match import.
 */
async function rebuildAfterVisibilityChange() {
  await rebuildStatRecords().catch((err) => {
    console.error('Failed to rebuild stat records after a visibility change:', err)
    throw error(500, 'Saved, but the records failed to rebuild — use Rebuild now')
  })
}

/** Every category per track, hidden ones included, with their edits. */
export const GET: RequestHandler = async ({ locals }) => {
  await requireAdmin(locals.user)

  const { tracks, display } = await editableTracks()
  const result = await Promise.all(
    tracks.map(async (track) => ({
      key: track.key,
      label: track.label,
      isDisplayed: track.key === display.key,
      categories: await loadTrackRecords(track.key, { includeHidden: true }),
    }))
  )

  return json({ tracks: result })
}

/**
 * Save an edit. With no entryKey it is category-wide (title, description,
 * hiding the category); with one it targets a single performance (value,
 * holder, team, hiding it). Fields left empty fall back to the stats.
 */
export const PUT: RequestHandler = async ({ locals, request }) => {
  const admin = await requireAdmin(locals.user)
  const body = await request.json().catch(() => ({}))
  const { track, category } = await parseTarget(body.track, body.category)
  const entryKey = normalizeOptional(body.entryKey) ?? CATEGORY_ENTRY_KEY
  const isEntry = entryKey !== CATEGORY_ENTRY_KEY

  const fields = isEntry
    ? {
        is_hidden: Boolean(body.isHidden),
        value_text: normalizeOptional(body.valueText),
        unit: normalizeOptional(body.unit),
        profile_id: normalizeOptional(body.profileId),
        player_name: normalizeOptional(body.playerName),
        team_id: normalizeOptional(body.teamId),
        label: normalizeOptional(body.label),
      }
    : {
        is_hidden: Boolean(body.isHidden),
        title: normalizeOptional(body.title),
        description: normalizeOptional(body.description),
      }

  const { data: previous } = await supabaseAdmin
    .from('stat_record_overrides')
    .select('is_hidden')
    .eq('track', track)
    .eq('category', category)
    .eq('entry_key', entryKey)
    .maybeSingle()

  const { error: upsertError } = await supabaseAdmin.from('stat_record_overrides').upsert(
    {
      track,
      category,
      entry_key: entryKey,
      ...fields,
      updated_by_profile_id: admin.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'track,category,entry_key' }
  )
  if (upsertError) throw error(500, 'Failed to save the record edit')

  if (isEntry && Boolean(previous?.is_hidden) !== fields.is_hidden) {
    await rebuildAfterVisibilityChange()
  }

  return json({ success: true })
}

/** Remove an edit, so the category or performance shows exactly as the stats have it. */
export const DELETE: RequestHandler = async ({ locals, url }) => {
  await requireAdmin(locals.user)

  const { track, category } = await parseTarget(
    url.searchParams.get('track'),
    url.searchParams.get('category')
  )
  const entryKey = url.searchParams.get('entryKey') ?? CATEGORY_ENTRY_KEY

  const { data: deleted, error: deleteError } = await supabaseAdmin
    .from('stat_record_overrides')
    .delete()
    .eq('track', track)
    .eq('category', category)
    .eq('entry_key', entryKey)
    .select('is_hidden')
  if (deleteError) throw error(500, 'Failed to reset the record')

  // Bringing back a hidden performance can put it back in the top 5.
  if (entryKey !== CATEGORY_ENTRY_KEY && (deleted ?? []).some((row) => row.is_hidden)) {
    await rebuildAfterVisibilityChange()
  }

  return json({ success: true })
}
