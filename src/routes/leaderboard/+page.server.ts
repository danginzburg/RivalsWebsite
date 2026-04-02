import type { PageServerLoad } from './$types'
import { supabaseAdmin } from '$lib/supabase/admin'

function getTeamLogoUrl(team: any): string | null {
  if (!team?.logo_path) return null
  return supabaseAdmin.storage.from('team-logos').getPublicUrl(team.logo_path).data.publicUrl
}

function safeInt(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export const load: PageServerLoad = async () => {
  // Leaderboard is computed from match results.

  const { data: teams, error: teamsError } = await supabaseAdmin
    .from('teams')
    .select('id, name, tag, logo_path')
    .eq('approval_status', 'approved')
    .order('name', { ascending: true })

  if (teamsError) {
    return { rows: [] }
  }

  const { data: matches } = await supabaseAdmin
    .from('matches')
    .select(
      'id, status, approval_status, team_a_id, team_b_id, team_a_score, team_b_score, winner_team_id'
    )
    .eq('status', 'completed')
    .eq('approval_status', 'approved')

  type Row = {
    team_id: string
    team: { id: string; name: string; tag: string | null; logo_url: string | null }
    series_played: number
    series_wins: number
    series_losses: number
    maps_played: number
    map_wins: number
    map_losses: number
    map_diff: number
  }

  const byTeam = new Map<string, Row>()
  for (const t of teams ?? []) {
    byTeam.set(t.id, {
      team_id: t.id,
      team: {
        id: t.id,
        name: t.name,
        tag: t.tag ?? null,
        logo_url: getTeamLogoUrl(t),
      },
      series_played: 0,
      series_wins: 0,
      series_losses: 0,
      maps_played: 0,
      map_wins: 0,
      map_losses: 0,
      map_diff: 0,
    })
  }

  for (const m of matches ?? []) {
    const a = byTeam.get(m.team_a_id)
    const b = byTeam.get(m.team_b_id)
    if (!a || !b) continue

    const aScore = safeInt(m.team_a_score)
    const bScore = safeInt(m.team_b_score)

    a.series_played += 1
    b.series_played += 1

    a.map_wins += aScore
    a.map_losses += bScore
    b.map_wins += bScore
    b.map_losses += aScore

    a.maps_played += aScore + bScore
    b.maps_played += aScore + bScore

    if (m.winner_team_id === a.team_id) {
      a.series_wins += 1
      b.series_losses += 1
    } else if (m.winner_team_id === b.team_id) {
      b.series_wins += 1
      a.series_losses += 1
    }
  }

  for (const row of byTeam.values()) {
    row.map_diff = row.map_wins - row.map_losses
  }

  const rows = Array.from(byTeam.values()).sort((x, y) => {
    if (y.series_wins !== x.series_wins) return y.series_wins - x.series_wins
    if (y.map_diff !== x.map_diff) return y.map_diff - x.map_diff
    if (y.map_wins !== x.map_wins) return y.map_wins - x.map_wins
    return x.team.name.localeCompare(y.team.name)
  })

  return { rows }
}
