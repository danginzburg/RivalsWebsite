import { supabaseAdmin } from './lib/db'
import { rebuildPlayerMatchStats } from '../src/lib/server/imports/matching'

async function main() {
  const apply = process.argv.includes('--apply')

  const { data: rows, error: rowsError } = await supabaseAdmin
    .from('player_match_map_stats')
    .select('id, match_id, match_map_id, team_id, player_name, kills, deaths, assists')
    .eq('rounds', 0)
  if (rowsError) throw new Error(`Failed to load map stats: ${rowsError.message}`)
  if (!rows?.length) {
    console.log('No rounds=0 map stat rows found. Nothing to do.')
    return
  }

  const mapIds = [...new Set(rows.map((r) => r.match_map_id))]
  const matchIds = [...new Set(rows.map((r) => r.match_id))]

  const { data: maps, error: mapsError } = await supabaseAdmin
    .from('match_maps')
    .select('id, team_a_rounds, team_b_rounds')
    .in('id', mapIds)
  if (mapsError) throw new Error(`Failed to load match_maps: ${mapsError.message}`)
  const mapById = new Map((maps ?? []).map((m) => [m.id, m]))

  const { data: matches, error: matchesError } = await supabaseAdmin
    .from('matches')
    .select('id, team_a_id, team_b_id')
    .in('id', matchIds)
  if (matchesError) throw new Error(`Failed to load matches: ${matchesError.message}`)
  const matchById = new Map((matches ?? []).map((m) => [m.id, m]))

  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${rows.length} rounds=0 map stat row(s)`)

  let updated = 0
  let skipped = 0
  const touchedMatches = new Set<string>()

  for (const row of rows) {
    const map = mapById.get(row.match_map_id)
    const match = matchById.get(row.match_id)
    const teamARounds = map?.team_a_rounds
    const teamBRounds = map?.team_b_rounds
    if (map == null || match == null || teamARounds == null || teamBRounds == null) {
      console.log(`skip ${row.id} (${row.player_name}): missing map score or match`)
      skipped++
      continue
    }

    const side =
      row.team_id === match.team_a_id ? 'a' : row.team_id === match.team_b_id ? 'b' : null
    const totalRounds = teamARounds + teamBRounds
    const roundsWon = side === 'a' ? teamARounds : side === 'b' ? teamBRounds : 0
    const roundsLost = side === 'a' ? teamBRounds : side === 'b' ? teamARounds : 0

    const patch = {
      rounds: totalRounds,
      rounds_won: roundsWon,
      rounds_lost: roundsLost,
      games_won: side && roundsWon > roundsLost ? 1 : 0,
      games_lost: side && roundsWon < roundsLost ? 1 : 0,
      kpr: totalRounds > 0 ? row.kills / totalRounds : 0,
      dpr: totalRounds > 0 ? row.deaths / totalRounds : 0,
      apr: totalRounds > 0 ? row.assists / totalRounds : 0,
    }

    console.log(
      `${apply ? 'update' : 'would update'} ${row.id} (${row.player_name}): rounds=${patch.rounds} won=${patch.rounds_won} lost=${patch.rounds_lost}${side ? '' : ' (no team side; rounds only)'}`
    )

    if (apply) {
      const { error: updateError } = await supabaseAdmin
        .from('player_match_map_stats')
        .update(patch)
        .eq('id', row.id)
      if (updateError) throw new Error(`Failed to update row ${row.id}: ${updateError.message}`)
    }
    updated++
    touchedMatches.add(row.match_id)
  }

  if (apply) {
    for (const matchId of touchedMatches) {
      await rebuildPlayerMatchStats(matchId)
      console.log(`rebuilt player_match_stats for ${matchId}`)
    }
  }

  console.log(
    `Done. ${updated} row(s) ${apply ? 'updated' : 'would be updated'}, ${skipped} skipped, ${touchedMatches.size} match(es)${apply ? ' rebuilt' : ''}.`
  )
  if (!apply) console.log('Run with --apply to write changes.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
