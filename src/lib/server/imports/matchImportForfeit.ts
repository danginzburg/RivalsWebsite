const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export function parseOptionalUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (!t.length) return null
  if (!isUuid(t)) return null
  return t
}

export function winnerFromMapSeriesScore(
  seriesTeamAScore: number,
  seriesTeamBScore: number,
  teamAId: string,
  teamBId: string
): string | null {
  if (seriesTeamAScore === seriesTeamBScore) return null
  return seriesTeamAScore > seriesTeamBScore ? teamAId : teamBId
}

export type AdminAwardResolution = {
  winnerTeamId: string | null
  matchForfeit: {
    kind: 'admin_award'
    forfeiting_team_id: string
    reason?: string
    map_notes?: Record<string, string>
  } | null
  /** map_order (1-based) -> metadata.forfeit object for match_maps */
  perMapForfeitMeta: Map<number, { forfeiting_team_id: string; label?: string }>
}

/**
 * When officialWinnerTeamId is set, it becomes matches.winner_team_id.
 * If it differs from the map-derived winner, we record admin_award forfeit metadata.
 */
export function resolveAdminAwardForfeit(options: {
  mapWinnerTeamId: string | null
  officialWinnerTeamId: string | null
  forfeitingTeamId: string | null
  teamAId: string
  teamBId: string
  reason: string | null
  mapNotes: Record<string, string> | null
  mapCount: number
}): AdminAwardResolution {
  const {
    mapWinnerTeamId,
    officialWinnerTeamId,
    forfeitingTeamId,
    teamAId,
    teamBId,
    reason,
    mapNotes,
    mapCount,
  } = options

  const participants = new Set([teamAId, teamBId])

  let winnerTeamId: string | null

  if (officialWinnerTeamId) {
    if (!participants.has(officialWinnerTeamId)) {
      throw new Error('officialWinnerTeamId must be one of the two match teams')
    }
    winnerTeamId = officialWinnerTeamId

    if (!mapWinnerTeamId) {
      const other = officialWinnerTeamId === teamAId ? teamBId : teamAId
      if (forfeitingTeamId && forfeitingTeamId !== other) {
        throw new Error(
          'forfeitingTeamId must be the non-winning team when the series was tied on maps'
        )
      }
    }
  } else {
    winnerTeamId = mapWinnerTeamId
  }

  const perMapForfeitMeta = new Map<number, { forfeiting_team_id: string; label?: string }>()

  if (!officialWinnerTeamId) {
    return { winnerTeamId, matchForfeit: null, perMapForfeitMeta }
  }

  const impliedForfeiting = mapWinnerTeamId
    ? mapWinnerTeamId
    : officialWinnerTeamId === teamAId
      ? teamBId
      : teamAId

  if (mapWinnerTeamId && officialWinnerTeamId === mapWinnerTeamId) {
    return { winnerTeamId, matchForfeit: null, perMapForfeitMeta }
  }

  if (mapWinnerTeamId && forfeitingTeamId && forfeitingTeamId !== mapWinnerTeamId) {
    throw new Error(
      'forfeitingTeamId must match the team that won on map score when overriding the series winner'
    )
  }

  const forfeiting_team_id = impliedForfeiting
  const map_notes: Record<string, string> | undefined =
    mapNotes && Object.keys(mapNotes).length > 0 ? { ...mapNotes } : undefined

  for (let order = 1; order <= mapCount; order++) {
    const key = String(order)
    const label = map_notes?.[key]
    perMapForfeitMeta.set(order, {
      forfeiting_team_id,
      ...(label ? { label } : {}),
    })
  }

  return {
    winnerTeamId,
    matchForfeit: {
      kind: 'admin_award',
      forfeiting_team_id,
      ...(reason ? { reason } : {}),
      ...(map_notes ? { map_notes } : {}),
    },
    perMapForfeitMeta,
  }
}

export function parseMapNotes(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object') return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim().length) out[String(k)] = v.trim()
  }
  return Object.keys(out).length ? out : null
}
