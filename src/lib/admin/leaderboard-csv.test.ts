import { describe, expect, it } from 'vitest'

import {
  guessMapping,
  missingRequiredFields,
  parseLeaderboardCsv,
  parseLeaderboardCsvWithMapping,
  readCsvHeaders,
} from './leaderboard-csv'

describe('leaderboard CSV mapping', () => {
  it('parses a modern series-and-maps sheet', () => {
    const csv = [
      'TEAM,POINTS,# SERIES,SERIES WINS,SERIES LOSSES,# MAPS,MAP WINS,MAP LOSSES,ROUND DIFF',
      'ROR,3,1,1,0,2,2,0,4',
    ].join('\n')

    const { rows, unmappedColumns } = parseLeaderboardCsv(csv)

    expect(unmappedColumns).toEqual([])
    expect(rows[0]).toEqual({
      team: 'ROR',
      points: 3,
      series_played: 1,
      series_wins: 1,
      series_losses: 0,
      maps_played: 2,
      map_wins: 2,
      map_losses: 0,
      round_diff: 4,
    })
  })

  it('mirrors a maps-only sheet into the series fields', () => {
    const csv = ['TEAM,POINTS,# MAPS,WINS,LOSSES,ROUND DIFF', 'FF,3,3,2,1,5'].join('\n')

    const { rows } = parseLeaderboardCsv(csv)

    // Map W/L stand in for both the map and series record, as the old
    // `maps_only` layout did, so events-page standings are not left at 0-0.
    expect(rows[0]).toMatchObject({
      series_played: 3,
      series_wins: 2,
      series_losses: 1,
      maps_played: 3,
      map_wins: 2,
      map_losses: 1,
      round_diff: 5,
    })
  })

  it('imports a sheet with an unknown column and no round diff', () => {
    // The exact shape of the user's "Shitter League" export.
    const csv = [
      'TEAM,POINTS,# SERIES,SERIES WINS,SERIES LOSSES,OOG POINTS,# MAPS,MAP WINS,MAP LOSSES',
      'ROR,3,1,1,0,0,2,2,0',
    ].join('\n')

    const { rows, unmappedColumns } = parseLeaderboardCsv(csv)

    expect(unmappedColumns).toEqual(['OOG POINTS'])
    expect(rows[0]).toMatchObject({ points: 3, map_wins: 2, round_diff: 0 })
  })

  it('drops Sheets placeholder rows with no team', () => {
    const csv = ['TEAM,POINTS,WINS,LOSSES', 'ROR,3,1,0', ',,0,'].join('\n')

    const { rows } = parseLeaderboardCsv(csv)

    expect(rows).toHaveLength(1)
    expect(rows[0].team).toBe('ROR')
  })

  it('prefers a specific header over a generic one', () => {
    const mapping = guessMapping(['TEAM', 'POINTS', 'SERIES WINS', 'MAP WINS'])
    expect(mapping.series_wins).toBe('SERIES WINS')
    expect(mapping.map_wins).toBe('MAP WINS')
  })

  it('flags required fields with no column', () => {
    const mapping = guessMapping(['SQUAD', 'SCORE'])
    const missing = missingRequiredFields(mapping).map((field) => field.id)
    expect(missing).toContain('team')
    expect(missing).toContain('points')
  })

  it('throws when a required field cannot be guessed', () => {
    expect(() => parseLeaderboardCsv('SQUAD,SCORE\nROR,3')).toThrow(/could not find a column/i)
  })

  it('honours an explicit mapping over the guess', () => {
    const csv = ['SQUAD,SCORE,W,L', 'ROR,3,1,0'].join('\n')
    const headers = readCsvHeaders(csv)
    const mapping = guessMapping(headers)
    mapping.team = 'SQUAD'
    mapping.points = 'SCORE'

    const { rows } = parseLeaderboardCsvWithMapping(csv, mapping)
    expect(rows[0]).toMatchObject({ team: 'ROR', points: 3 })
  })
})
