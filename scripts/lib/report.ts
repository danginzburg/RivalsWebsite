export type DryRunSeriesResult = {
  key: string
  teamAName: string
  teamBName: string
  date: string | null
  action: 'create' | 'update'
  existingMatchId: string | null
  mapCount: number
  playerRowCount: number
  unmatchedPlayers: string[]
}

export type DryRunReportInput = {
  generatedAt: string
  totalSeries: number
  blockers: string[]
  softIssues: string[]
  results: DryRunSeriesResult[]
  summary: {
    creates: number
    updates: number
    totalMaps: number
    totalPlayerRows: number
    totalUnmatchedPlayers: number
  }
}

function heading(title: string): string {
  return `## ${title}\n`
}

export function renderDryRunMarkdown(input: DryRunReportInput): string {
  const lines: string[] = []
  lines.push('# Dry Run Report', '', `Generated: ${input.generatedAt}`, '')

  lines.push(heading('Summary'))
  lines.push(`- Total series considered: ${input.totalSeries}`)
  lines.push(`- Matches to create: ${input.summary.creates}`)
  lines.push(`- Matches to update (idempotent overwrite): ${input.summary.updates}`)
  lines.push(`- Total maps: ${input.summary.totalMaps}`)
  lines.push(`- Total player-map rows: ${input.summary.totalPlayerRows}`)
  lines.push(`- Total unmatched player rows: ${input.summary.totalUnmatchedPlayers}`)
  lines.push('')

  lines.push(heading(`Blockers (${input.blockers.length})`))
  if (input.blockers.length === 0) {
    lines.push('None.')
  } else {
    for (const b of input.blockers) lines.push(`- ${b}`)
  }
  lines.push('')

  lines.push(heading(`Soft issues (${input.softIssues.length})`))
  if (input.softIssues.length === 0) {
    lines.push('None.')
  } else {
    for (const s of input.softIssues) lines.push(`- ${s}`)
  }
  lines.push('')

  lines.push(heading('Series detail'))
  lines.push(
    '| Key | Teams | Date | Action | Existing match | Maps | Player rows | Unmatched players |'
  )
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const r of input.results) {
    lines.push(
      `| ${r.key} | ${r.teamAName} vs ${r.teamBName} | ${r.date ?? ''} | ${r.action} | ${r.existingMatchId ?? '-'} | ${r.mapCount} | ${r.playerRowCount} | ${r.unmatchedPlayers.length} |`
    )
  }
  lines.push('')

  return lines.join('\n')
}
