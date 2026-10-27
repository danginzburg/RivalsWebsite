/**
 * CSV export of signups: each player's Riot ID, Discord handle and final score.
 */

export type ExportableSignup = {
  display_name: string | null
  riot_tag: string | null
  discord_handle: string | null
  /** The final score shown on the signup: formula plus adjustment. */
  score: number | null
}

const COLUMNS = ['player', 'discord', 'score'] as const

function cell(value: string | number | null | undefined): string {
  if (value == null) return '""'
  return `"${String(value).replace(/"/g, '""')}"`
}

export function signupsToCsv(signups: ExportableSignup[]): string {
  const lines = [COLUMNS.map(cell).join(',')]

  for (const signup of signups) {
    const name = signup.display_name?.trim() ?? ''
    const tag = signup.riot_tag?.trim()
    lines.push(
      [tag ? `${name}#${tag}` : name, signup.discord_handle, signup.score].map(cell).join(',')
    )
  }

  // CRLF and a trailing newline keep spreadsheet apps happy.
  return lines.join('\r\n') + '\r\n'
}
