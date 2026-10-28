import { bracketThirdPlaceTeamIds, buildPickemSlots } from '$lib/pickems'
import { getPickemResults, getPublishedPickemContextBySeasonId } from '$lib/server/pickems'
import { loadLegacyBracket } from '$lib/server/seasons/legacyBracket'
import { supabaseAdmin } from '$lib/supabase/admin'

/**
 * The team(s) that finished 3rd in a season's playoffs, read off its bracket.
 *
 * An admin-set `seasons.third_place_team_id` wins, for seasons whose bracket the
 * site cannot draw. Otherwise 3rd comes from the bracket the events page draws:
 * the season's pick'em bracket, or the archived one in `seasons.metadata` when
 * there is none. Results are layered the same way the events page does it —
 * linked real matches, then admin-resolved winners — so the two always agree.
 *
 * Returns an empty list when the season has no bracket or it is not decided.
 */
export async function loadSeasonThirdPlaceTeamIds(seasonId: string): Promise<string[]> {
  try {
    const { data: season } = await supabaseAdmin
      .from('seasons')
      .select('metadata, third_place_team_id')
      .eq('id', seasonId)
      .maybeSingle()
    if (season?.third_place_team_id) return [season.third_place_team_id]

    const ctx = await getPublishedPickemContextBySeasonId(seasonId)
    if (ctx.event?.format === 'bracket' && ctx.matches.length > 0) {
      const { linkedResults } = await getPickemResults(ctx.event, ctx.matches)
      const slots = buildPickemSlots(ctx.event, ctx.matches, { picks: {} }, linkedResults)
      return bracketThirdPlaceTeamIds(ctx.matches, slots)
    }

    const legacy = await loadLegacyBracket(season?.metadata)
    return legacy ? bracketThirdPlaceTeamIds(legacy.matches, legacy.slots) : []
  } catch (err) {
    // A badge is not worth failing the page over.
    console.error('Failed to resolve 3rd place for season', seasonId, err)
    return []
  }
}
