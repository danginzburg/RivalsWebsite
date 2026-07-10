import { supabaseAdmin } from './lib/db'
import { argValue } from './lib/cli'
import { rebuildPlayerMatchStats } from '../src/lib/server/imports/matching'

async function main() {
  const apply = process.argv.includes('--apply')
  const onlyMatchId = argValue('--match-id')

  let matchIds: string[]
  if (onlyMatchId) {
    matchIds = [onlyMatchId]
  } else {
    const { data, error } = await supabaseAdmin.from('player_match_map_stats').select('match_id')
    if (error) throw new Error(`Failed to load player_match_map_stats: ${error.message}`)
    matchIds = [...new Set((data ?? []).map((r) => r.match_id as string))]
  }

  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${matchIds.length} match(es) with map stats`)

  let mismatches = 0
  for (const matchId of matchIds) {
    const { data: mapRows, error: mapError } = await supabaseAdmin
      .from('player_match_map_stats')
      .select('profile_id, team_id')
      .eq('match_id', matchId)
    if (mapError) throw new Error(`Failed to load map stats for ${matchId}: ${mapError.message}`)

    const eligibleProfiles = new Set(
      (mapRows ?? []).filter((r) => r.profile_id && r.team_id).map((r) => r.profile_id as string)
    )

    const { count, error: countError } = await supabaseAdmin
      .from('player_match_stats')
      .select('id', { count: 'exact', head: true })
      .eq('match_id', matchId)
    if (countError)
      throw new Error(`Failed to count match stats for ${matchId}: ${countError.message}`)

    const current = count ?? 0
    const expected = eligibleProfiles.size
    const status = current === expected ? 'ok' : 'MISMATCH'
    if (current !== expected) mismatches++
    console.log(
      `${matchId}: map rows=${mapRows?.length ?? 0} grouped players=${expected} match stats rows=${current} ${status}`
    )

    if (apply) {
      await rebuildPlayerMatchStats(matchId)
      console.log(`${matchId}: rebuilt`)
    }
  }

  console.log(`Done. ${mismatches} mismatch(es).${apply ? '' : ' Run with --apply to rebuild.'}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
