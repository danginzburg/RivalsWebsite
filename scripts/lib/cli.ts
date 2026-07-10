import { readFileSync } from 'node:fs'
import path from 'node:path'

export const OUT_DIR = path.join(process.cwd(), 'scripts', 'out')
export const DATA_DIR = path.join(process.cwd(), 'scripts', 'data')

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf-8')) as T
}

export function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return null
  return process.argv[idx + 1] ?? null
}

export type TeamAlias = { teamId: string } | { create: { name: string; tag: string } }

export function readTeamAliases(file: string): Record<string, TeamAlias> {
  const raw = readJson<Record<string, TeamAlias>>(file)
  return Object.fromEntries(Object.entries(raw).filter(([key]) => key !== '_meta')) as Record<
    string,
    TeamAlias
  >
}
