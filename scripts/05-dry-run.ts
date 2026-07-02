import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { supabaseAdmin } from './lib/db'
import { renderDryRunMarkdown, type DryRunSeriesResult } from './lib/report'
import { OUT_DIR, DATA_DIR, readJson, readTeamAliases } from './lib/cli'
import type { ImportSeriesPayload } from './04-join-map-stats'
import {
  MATCH_RESOLUTION_WINDOW_MS,
  pickNearestMatch,
} from '../src/lib/server/matches/import-lifecycle'

function normalizeTeamKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function resolutionWindow(isoString: string) {
  const anchor = new Date(isoString).getTime()
  return {
    start: new Date(anchor - MATCH_RESOLUTION_WINDOW_MS).toISOString(),
    end: new Date(anchor + MATCH_RESOLUTION_WINDOW_MS).toISOString(),
  }
}

async function main() {
  const joinedFile = path.join(OUT_DIR, 'joined.json')
  const teamsFile = path.join(DATA_DIR, 'aliases.teams.json')
  if (!existsSync(joinedFile))
    throw new Error('Run npm run sheets:join first (missing joined.json)')

  const payloads = readJson<ImportSeriesPayload[]>(joinedFile)
  const teamAliases = readTeamAliases(teamsFile)

  const blockers: string[] = []
  const softIssues: string[] = []
  const results: DryRunSeriesResult[] = []

  let creates = 0
  let updates = 0
  let totalMaps = 0
  let totalPlayerRows = 0
  let totalUnmatchedPlayers = 0

  const seenPairDate = new Map<string, string[]>()

  for (const payload of payloads) {
    const firstMap = payload.maps[0]
    if (!firstMap) {
      blockers.push(`${payload.seriesKey}: no maps in payload`)
      continue
    }

    const teamAAlias = teamAliases[firstMap.teamAName]
    const teamBAlias = teamAliases[firstMap.teamBName]
    if (!teamAAlias || !teamBAlias) {
      blockers.push(
        `${payload.seriesKey}: no alias entry for ${[
          !teamAAlias ? firstMap.teamAName : null,
          !teamBAlias ? firstMap.teamBName : null,
        ]
          .filter(Boolean)
          .join(', ')} (run sheets:resolve / edit aliases.teams.json)`
      )
      continue
    }

    // importCompletedSeries rejects any map without player rows, so an
    // incomplete join blocks the whole series at apply time.
    const mapsWithoutStats = payload.maps.filter((m) => m.playerRows.length === 0)
    if (mapsWithoutStats.length > 0) {
      blockers.push(
        `${payload.seriesKey}: ${mapsWithoutStats.length} map(s) with no player stats joined (fix tab-overrides.json)`
      )
      continue
    }

    const pairKey = [normalizeTeamKey(firstMap.teamAName), normalizeTeamKey(firstMap.teamBName)]
      .sort()
      .join('__')
    const dateKey = firstMap.scheduledAt ?? 'unknown'
    const combinedKey = `${pairKey}__${dateKey}`
    const bucket = seenPairDate.get(combinedKey) ?? []
    bucket.push(payload.seriesKey)
    seenPairDate.set(combinedKey, bucket)

    let existingMatchId: string | null = null
    if (
      teamAAlias &&
      'teamId' in teamAAlias &&
      teamBAlias &&
      'teamId' in teamBAlias &&
      firstMap.scheduledAt
    ) {
      const { start, end } = resolutionWindow(firstMap.scheduledAt)
      const { data } = await supabaseAdmin
        .from('matches')
        .select('id, team_a_id, team_b_id, scheduled_at')
        .or(
          `and(team_a_id.eq.${teamAAlias.teamId},team_b_id.eq.${teamBAlias.teamId}),and(team_a_id.eq.${teamBAlias.teamId},team_b_id.eq.${teamAAlias.teamId})`
        )
        .gte('scheduled_at', start)
        .lte('scheduled_at', end)

      existingMatchId = pickNearestMatch(data ?? [], firstMap.scheduledAt)?.id ?? null
    } else {
      softIssues.push(
        `${payload.seriesKey}: team not yet created in DB, cannot check for existing match`
      )
    }

    const action: 'create' | 'update' = existingMatchId ? 'update' : 'create'
    if (action === 'create') creates++
    else updates++

    const playerRowCount = payload.maps.reduce((t, m) => t + m.playerRows.length, 0)
    const unmatchedPlayers = Array.from(
      new Set(
        payload.maps.flatMap((m) =>
          m.playerRows.filter((r) => !r.profile_id).map((r) => r.player_name)
        )
      )
    )

    totalMaps += payload.maps.length
    totalPlayerRows += playerRowCount
    totalUnmatchedPlayers += unmatchedPlayers.length

    if (unmatchedPlayers.length > 0) {
      softIssues.push(`${payload.seriesKey}: ${unmatchedPlayers.length} unmatched players`)
    }

    results.push({
      key: payload.seriesKey,
      teamAName: firstMap.teamAName,
      teamBName: firstMap.teamBName,
      date: firstMap.scheduledAt,
      action,
      existingMatchId,
      mapCount: payload.maps.length,
      playerRowCount,
      unmatchedPlayers,
    })
  }

  for (const [key, keys] of seenPairDate.entries()) {
    if (keys.length > 1) {
      softIssues.push(`Ambiguous same-pair-same-day series: ${key} -> ${keys.join(', ')}`)
    }
  }

  const report = renderDryRunMarkdown({
    generatedAt: new Date().toISOString(),
    totalSeries: payloads.length,
    blockers,
    softIssues,
    results,
    summary: {
      creates,
      updates,
      totalMaps,
      totalPlayerRows,
      totalUnmatchedPlayers,
    },
  })

  writeFileSync(path.join(OUT_DIR, 'dry-run.md'), report)

  console.log(
    `Dry run complete: ${payloads.length} series, ${creates} creates, ${updates} updates.`
  )
  console.log(`Blockers: ${blockers.length}, soft issues: ${softIssues.length}`)
  console.log(`Wrote ${path.join(OUT_DIR, 'dry-run.md')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
