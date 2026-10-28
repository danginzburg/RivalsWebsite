/**
 * Normalize a pasted map-veto log into the one-line-per-step form the match
 * page renders. Accepts the tournament-bot log format, e.g.
 *
 *   25. Oct.2026 23:06:23 UTC: Team 2 (BTS) bans Map "Sunset"!
 *   30. Oct.2026 23:14:07 UTC: Map "Abyss" will be decider!
 *   31. Oct.2026 23:14:10 UTC: Team 2 (BTS) picked "Attacker" as Side to start on Map "Lotus"!
 *
 * Side choices are folded onto their map's line rather than kept as their own
 * steps, so they don't read as extra picks. Input that isn't a log (the
 * hand-typed "Ban: Team A - Haven" style) passes through untouched, which also
 * makes re-saving already-normalized lines a no-op.
 */

const TIMESTAMP_PREFIX = /^.*?\bUTC:\s*/i
const BAN_OR_PICK = /^Team\s*\d+\s*\((.+?)\)\s+(bans|picks)\s+Map\s+"(.+?)"!?$/i
const DECIDER = /^Map\s+"(.+?)"\s+will\s+be\s+(?:the\s+)?decider!?$/i
const SIDE =
  /^Team\s*\d+\s*\((.+?)\)\s+picked\s+"(.+?)"\s+as\s+Side\s+to\s+start\s+on\s+Map\s+"(.+?)"!?$/i

export function normalizeVetoLines(lines: string[]): string[] {
  const stripped = lines.map((line) => line.trim().replace(TIMESTAMP_PREFIX, '').trim())
  const isLog = stripped.some(
    (line) => BAN_OR_PICK.test(line) || DECIDER.test(line) || SIDE.test(line)
  )
  if (!isLog) return lines.map((line) => line.trim()).filter(Boolean)

  const steps: { map: string | null; text: string }[] = []
  const sides: { team: string; side: string; map: string }[] = []

  for (const line of stripped) {
    if (!line) continue
    let m = BAN_OR_PICK.exec(line)
    if (m) {
      steps.push({ map: m[3], text: `${m[1]} ${m[2].toLowerCase()} ${m[3]}` })
      continue
    }
    m = DECIDER.exec(line)
    if (m) {
      steps.push({ map: m[1], text: `${m[1]} decider` })
      continue
    }
    m = SIDE.exec(line)
    if (m) {
      sides.push({ team: m[1], side: m[2], map: m[3] })
      continue
    }
    steps.push({ map: null, text: line })
  }

  for (const { team, side, map } of sides) {
    const sideText = `${team} starts ${side}`
    const step = steps.find((s) => s.map?.toLowerCase() === map.toLowerCase())
    if (step) step.text += ` · ${sideText}`
    else steps.push({ map: null, text: `${sideText} on ${map}` })
  }

  return steps.map((s) => s.text)
}
