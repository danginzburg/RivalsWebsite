import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { supabaseAdmin, resolveAdminUserId } from './lib/db'
import { OUT_DIR, DATA_DIR, readJson, readTeamAliases, argValue, type TeamAlias } from './lib/cli'
import { importCompletedSeries } from '../src/lib/server/matches/import-lifecycle'
import type { ImportSeriesPayload } from './04-join-map-stats'

type AppliedRecord = {
  seriesKey: string
  matchId: string
  appliedAt: string
}

async function ensureTeamsCreated(
  teamAliases: Record<string, TeamAlias>,
  teamsFile: string
): Promise<Record<string, TeamAlias>> {
  const updated = { ...teamAliases }
  let dirty = false

  for (const [code, alias] of Object.entries(teamAliases)) {
    if (!('create' in alias)) continue

    if (alias.create.name.startsWith('PLACEHOLDER-NEEDS-REVIEW')) {
      throw new Error(
        `Team alias "${code}" still has a PLACEHOLDER-NEEDS-REVIEW name. Edit scripts/data/aliases.teams.json before applying.`
      )
    }

    const { data: existing } = await supabaseAdmin
      .from('teams')
      .select('id, metadata, approval_status')
      .eq('name', alias.create.name)
      .maybeSingle()

    if (existing) {
      updated[code] = { teamId: existing.id }
      const metadata = (existing.metadata ?? {}) as Record<string, unknown>
      const matchImportNames = Array.isArray(metadata.match_import_names)
        ? metadata.match_import_names.map(String)
        : []
      const leaderboardImportTags = Array.isArray(metadata.leaderboard_import_tags)
        ? metadata.leaderboard_import_tags.map(String)
        : []
      const nextMetadata = {
        ...metadata,
        match_import_names: Array.from(new Set([...matchImportNames, code, alias.create.name])),
        leaderboard_import_tags: Array.from(
          new Set([...leaderboardImportTags, alias.create.tag, code])
        ),
      }
      const { error: updateError } = await supabaseAdmin
        .from('teams')
        .update({
          approval_status: 'approved',
          metadata: nextMetadata,
        })
        .eq('id', existing.id)
      if (updateError)
        throw new Error(
          `Failed to approve existing team for alias "${code}": ${updateError.message}`
        )
      dirty = true
      continue
    }

    const { data: created, error } = await supabaseAdmin
      .from('teams')
      .insert({
        name: alias.create.name,
        tag: alias.create.tag,
        approval_status: 'approved',
        metadata: {
          match_import_names: [code, alias.create.name],
          leaderboard_import_tags: [alias.create.tag, code],
          created_by_sheets_import: true,
        },
      })
      .select('id')
      .single()

    if (error || !created)
      throw new Error(`Failed to create team for alias "${code}": ${error?.message}`)

    updated[code] = { teamId: created.id }
    dirty = true
  }

  if (dirty) writeFileSync(teamsFile, JSON.stringify(updated, null, 2))
  return updated
}

// importCompletedSeries resolves teams by name/match_import_names, but 02 may have
// matched a sheet code via leaderboard tag only. Make every aliased code resolvable
// by ensuring it is listed in the team's match_import_names metadata.
async function ensureImportNames(teamAliases: Record<string, TeamAlias>) {
  const codesByTeamId = new Map<string, string[]>()
  for (const [code, alias] of Object.entries(teamAliases)) {
    if (!('teamId' in alias)) continue
    codesByTeamId.set(alias.teamId, [...(codesByTeamId.get(alias.teamId) ?? []), code])
  }
  if (codesByTeamId.size === 0) return

  const { data: teams, error } = await supabaseAdmin
    .from('teams')
    .select('id, name, metadata, approval_status')
    .in('id', Array.from(codesByTeamId.keys()))
  if (error) throw new Error(`Failed to load aliased teams: ${error.message}`)

  for (const team of teams ?? []) {
    const metadata = (team.metadata ?? {}) as Record<string, unknown>
    const existing = Array.isArray(metadata.match_import_names)
      ? metadata.match_import_names.map(String)
      : []
    const known = new Set([team.name, ...existing].map((n) => n.trim().toLowerCase()))
    const missing = (codesByTeamId.get(team.id) ?? []).filter(
      (code) => !known.has(code.trim().toLowerCase())
    )
    if (missing.length === 0 && team.approval_status === 'approved') continue

    const { error: updateError } = await supabaseAdmin
      .from('teams')
      .update({
        approval_status: 'approved',
        metadata: { ...metadata, match_import_names: [...existing, ...missing] },
      })
      .eq('id', team.id)
    if (updateError)
      throw new Error(
        `Failed to update match_import_names for team ${team.id}: ${updateError.message}`
      )
    console.log(`Added match_import_names ${missing.join(', ')} to team ${team.name}`)
  }
}

async function main() {
  const joinedFile = path.join(OUT_DIR, 'joined.json')
  const teamsFile = path.join(DATA_DIR, 'aliases.teams.json')
  const appliedFile = path.join(OUT_DIR, 'applied.json')

  if (!existsSync(joinedFile))
    throw new Error('Run npm run sheets:join first (missing joined.json)')

  const rollback = process.argv.includes('--rollback')
  if (rollback) {
    if (!existsSync(appliedFile)) {
      console.log('No applied.json found; nothing to roll back.')
      return
    }
    const applied = readJson<AppliedRecord[]>(appliedFile)
    console.log(`Rollback (best-effort) for ${applied.length} applied series:`)
    for (const record of applied) {
      console.log(`  - series ${record.seriesKey} -> match ${record.matchId}`)
    }
    console.log(
      'Re-running sheets:apply is idempotent and safe. Matches are not deleted automatically: ' +
        'a listed match may pre-date this import (same teams, same day) or carry later manual edits.'
    )
    console.log(
      'To delete a match you have verified was created by this tool and has no unrelated edits: ' +
        'delete from player_match_map_stats where match_map_id in (select id from match_maps where match_id = <id>); ' +
        'delete from match_maps where match_id = <id>; delete from matches where id = <id>;'
    )
    return
  }

  const only = argValue('--only')
  const limitRaw = argValue('--limit')
  const limit = limitRaw ? Number(limitRaw) : null
  const adminOverride = argValue('--admin')

  const payloads = readJson<ImportSeriesPayload[]>(joinedFile)
  const teamAliases = readTeamAliases(teamsFile)

  const { profileId } = await resolveAdminUserId(adminOverride)
  const resolvedTeamAliases = await ensureTeamsCreated(teamAliases, teamsFile)
  await ensureImportNames(resolvedTeamAliases)

  let toApply = payloads
  if (only) toApply = toApply.filter((p) => p.seriesKey === only)
  if (limit && Number.isFinite(limit)) toApply = toApply.slice(0, limit)

  const applied: AppliedRecord[] = existsSync(appliedFile)
    ? readJson<AppliedRecord[]>(appliedFile)
    : []

  for (const payload of toApply) {
    const firstMap = payload.maps[0]
    if (!firstMap) {
      console.warn(`Skipping ${payload.seriesKey}: no maps`)
      continue
    }

    const teamAAlias = resolvedTeamAliases[firstMap.teamAName]
    const teamBAlias = resolvedTeamAliases[firstMap.teamBName]
    if (!teamAAlias || !('teamId' in teamAAlias) || !teamBAlias || !('teamId' in teamBAlias)) {
      console.warn(`Skipping ${payload.seriesKey}: unresolved team alias`)
      continue
    }

    const mapsWithoutStats = payload.maps.filter((m) => m.playerRows.length === 0)
    if (mapsWithoutStats.length > 0) {
      console.warn(
        `Skipping ${payload.seriesKey}: ${mapsWithoutStats.length} map(s) with no player stats joined (importCompletedSeries would reject the series; fix tab-overrides.json)`
      )
      continue
    }

    const importPayload: Record<string, unknown> = {
      bestOf: payload.bestOf,
      displayName: payload.displayName,
      maps: payload.maps.map((m) => ({
        sourceFilename: m.source,
        mapName: m.mapName,
        scheduledAt: m.scheduledAt,
        teamAName: m.teamAName,
        teamBName: m.teamBName,
        teamARounds: m.teamARounds,
        teamBRounds: m.teamBRounds,
        playerRows: m.playerRows,
      })),
    }

    try {
      const response = await importCompletedSeries({
        payload: importPayload,
        adminProfileId: profileId,
      })
      const result = (await response.json()) as { matchId: string }
      const record: AppliedRecord = {
        seriesKey: payload.seriesKey,
        matchId: result.matchId,
        appliedAt: new Date().toISOString(),
      }
      const existingIdx = applied.findIndex((a) => a.seriesKey === payload.seriesKey)
      if (existingIdx >= 0) applied[existingIdx] = record
      else applied.push(record)

      console.log(`Applied ${payload.seriesKey} -> match ${result.matchId}`)
    } catch (err) {
      console.error(`Failed to apply ${payload.seriesKey}:`, err)
    }
  }

  writeFileSync(appliedFile, JSON.stringify(applied, null, 2))
  console.log(`Wrote ${appliedFile}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
