const RANK_ORDER: Record<string, number> = {
  iron: 100,
  bronze: 200,
  silver: 300,
  gold: 400,
  platinum: 500,
  diamond: 600,
  ascendant: 700,
  immortal: 800,
  radiant: 1400,
}

export type ParsedRank = {
  name: string
  tier: number | null
  rr: number | null
  value: number
  baseValue: number
  imageKey: string
}

export function parseRank(raw: string | null | undefined): ParsedRank | null {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  const rrMatch = trimmed.match(/^(immortal)\s+(\d+)\s*rr$/i)
  if (rrMatch) {
    const rr = parseInt(rrMatch[2], 10)
    const imgTier = rr >= 200 ? 3 : rr >= 90 ? 2 : 1
    return {
      name: 'Immortal',
      tier: null,
      rr,
      value: RANK_ORDER.immortal + rr,
      baseValue: RANK_ORDER.immortal,
      imageKey: `Immortal_${imgTier}_Rank`,
    }
  }

  const tierMatch = trimmed.match(/^(\w+)\s+(\d)$/i)
  if (tierMatch) {
    const name = tierMatch[1]
    const tier = parseInt(tierMatch[2], 10)
    const key = name.toLowerCase()
    const base = RANK_ORDER[key]
    if (base == null) return null
    return {
      name: name.charAt(0).toUpperCase() + name.slice(1).toLowerCase(),
      tier,
      rr: null,
      value: base + tier,
      baseValue: base,
      imageKey: `${name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()}_${tier}_Rank`,
    }
  }

  if (/^radiant$/i.test(trimmed)) {
    return {
      name: 'Radiant',
      tier: null,
      rr: null,
      value: RANK_ORDER.radiant,
      baseValue: RANK_ORDER.radiant,
      imageKey: 'Radiant_Rank',
    }
  }

  return null
}

export function rankValue(raw: string | null | undefined): number {
  return parseRank(raw)?.value ?? 0
}

export function rankBaseValue(raw: string | null | undefined): number {
  return parseRank(raw)?.baseValue ?? 0
}

export function rankImageKey(raw: string | null | undefined): string | null {
  return parseRank(raw)?.imageKey ?? null
}
